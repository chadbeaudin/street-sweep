import { NextRequest, NextResponse } from 'next/server';
import { fetchOSMData } from '@/lib/overpass';
import { StreetGraph, filterRiddenRoadsToBbox } from '@/lib/graph';
import { z } from 'zod';
import { LatLon, BBox, PolylineList, RoutingOptions, parseBody } from '@/lib/validation';
import { buildStepPathCoords } from '@/lib/stepPath';

const Body = z.object({
    point: LatLon,
    lastPoint: LatLon.optional().nullable(),
    bbox: BBox,
    manualRoute: PolylineList.optional().nullable(),
    riddenRoads: PolylineList.optional().nullable(),
    routingOptions: RoutingOptions,
});

export async function POST(req: NextRequest) {
    try {
        const parsed = await parseBody(req, Body);
        if ('error' in parsed) return parsed.error;
        const { point, lastPoint, bbox, manualRoute, riddenRoads, routingOptions } = parsed.data;

        const BUFFER = 0.01; // small buffer beyond the union area for edge connectivity
        const GRID = 0.01;   // Snap to 1km grid for caching

        // Expand to include both click points and the full viewport bbox.
        // This ensures highway crossings visible on screen are always in the graph,
        // even when the two waypoints are on opposite sides of a divided highway.
        let minLat = point.lat;
        let maxLat = point.lat;
        let minLon = point.lon;
        let maxLon = point.lon;

        if (lastPoint) {
            minLat = Math.min(minLat, lastPoint.lat);
            maxLat = Math.max(maxLat, lastPoint.lat);
            minLon = Math.min(minLon, lastPoint.lon);
            maxLon = Math.max(maxLon, lastPoint.lon);
        }

        // Union with the viewport bbox so the graph covers the same area the user sees
        minLat = Math.min(minLat, bbox.south);
        maxLat = Math.max(maxLat, bbox.north);
        minLon = Math.min(minLon, bbox.west);
        maxLon = Math.max(maxLon, bbox.east);

        const roundToGrid = (n: number, down: boolean) => {
            const val = down ? Math.floor(n / GRID) * GRID : Math.ceil(n / GRID) * GRID;
            return Number(val.toFixed(4));
        };

        const bufferedBbox = {
            south: roundToGrid(minLat - BUFFER, true),
            west: roundToGrid(minLon - BUFFER, true),
            north: roundToGrid(maxLat + BUFFER, false),
            east: roundToGrid(maxLon + BUFFER, false)
        };

        // Use the cached graph for speed. We now apply penalties dynamically
        // during pathfinding instead of mutating the graph weights. A graph cached
        // for an earlier viewport is reused as long as it still spans both clicks.
        const reuseKey = StreetGraph.reuseKey(riddenRoads as [number, number][][] | undefined, routingOptions);
        const clicksArea = {
            south: Math.min(point.lat, lastPoint?.lat ?? point.lat) - BUFFER,
            west: Math.min(point.lon, lastPoint?.lon ?? point.lon) - BUFFER,
            north: Math.max(point.lat, lastPoint?.lat ?? point.lat) + BUFFER,
            east: Math.max(point.lon, lastPoint?.lon ?? point.lon) + BUFFER,
        };
        const graph = StreetGraph.findCachedGraphCovering(clicksArea, reuseKey)
            ?? StreetGraph.getCachedGraph(bufferedBbox, await fetchOSMData(bufferedBbox), filterRiddenRoadsToBbox(riddenRoads as [number, number][][] | undefined, bufferedBbox), routingOptions, reuseKey);

        // Get link IDs that should be penalized: already traversed in the current
        // session (avoid backtracking) and already ridden per Strava (prefer new
        // streets — point-to-point routing previously ignored ridden status entirely).
        // Deliberately separate from the area-mode riddenPenalty slider (default 15):
        // point-to-point has no bounded "required road" to fall back on like the CPP
        // solver does, so a strong penalty can drag the path into a large detour
        // chasing distant unridden streets instead of a sensible mostly-unridden route.
        let penalizedLinks: Map<string, number> | undefined;
        if (manualRoute && Array.isArray(manualRoute) && manualRoute.length > 0) {
            penalizedLinks = graph.getTraversalPenalties(manualRoute as [number, number][][], 5);
        }
        const pointRoutePenalty = routingOptions?.pointRoutePenalty || 4;
        const riddenPenalties = graph.buildRiddenPenaltyMap(pointRoutePenalty);
        if (riddenPenalties.size > 0) {
            penalizedLinks = penalizedLinks ?? new Map<string, number>();
            for (const [linkId, mult] of riddenPenalties) {
                penalizedLinks.set(linkId, (penalizedLinks.get(linkId) ?? 1) * mult);
            }
        }

        const snappedData = graph.findClosestPointOnEdge(point.lat, point.lon);
        if (!snappedData) {
            const nodeCount = graph.graph.getNodeCount();
            console.error(`[Step] Could not snap point (${point.lat.toFixed(5)}, ${point.lon.toFixed(5)}). Graph has ${nodeCount} nodes — OSM data may be unavailable.`);
            return NextResponse.json({ error: `Could not snap point to road network (${nodeCount} nodes loaded). Overpass API may be unavailable — try again shortly.` }, { status: 404 });
        }

        let endSnap = snappedData;
        let pathCoords: [number, number][] = [];

        if (lastPoint) {
            const prevSnappedData = graph.findClosestPointOnEdge(lastPoint.lat, lastPoint.lon);
            if (prevSnappedData) {
                // Try all combinations of start/end snap-edge endpoints to find any valid path.
                // Sorting by proximity to the click points means we try the "natural" pair first
                // and fall back to alternatives only when the graph is disconnected at those nodes.
                const startOptions = [prevSnappedData.u, prevSnappedData.v].sort((a, b) => {
                    const na = graph.graph.getNode(a);
                    const nb = graph.graph.getNode(b);
                    if (!na || !nb) return 0;
                    const da = (na.data.lat - lastPoint.lat) ** 2 + (na.data.lon - lastPoint.lon) ** 2;
                    const db = (nb.data.lat - lastPoint.lat) ** 2 + (nb.data.lon - lastPoint.lon) ** 2;
                    return da - db;
                });
                const endTargets = new Set([snappedData.u, snappedData.v]);

                let pathResult: { path: { id: string, idNext: string, weight: number }[], targetId: string } | null = null;
                let usedStartId: string | null = null;

                for (const sid of startOptions) {
                    const r = graph.findClosestTargetCapped(sid, endTargets, penalizedLinks);
                    if (r) { pathResult = r; usedStartId = sid; break; }
                }

                // Fallback: the click's snap edge is disconnected from the start, so move
                // the waypoint onto the closest street within ~550m that the start can reach.
                if (!pathResult) {
                    for (const sid of startOptions) {
                        const reachableSnap = graph.findClosestReachablePointOnEdge(sid, point.lat, point.lon, 10);
                        if (!reachableSnap) continue;
                        const r = graph.findClosestTargetCapped(sid, new Set([reachableSnap.u, reachableSnap.v]), penalizedLinks);
                        if (r) { pathResult = r; usedStartId = sid; endSnap = reachableSnap; break; }
                    }
                }

                if (!pathResult || !usedStartId) {
                    console.warn(`[Step] No path found from [${startOptions.join(',')}] to [${[...endTargets].join(',')}] — graph may be disconnected here.`);
                } else {
                    pathCoords = buildStepPathCoords(prevSnappedData, endSnap, usedStartId, pathResult.targetId, pathResult.path, id => graph.graph.getNode(id)?.data);
                }
            }
        }

        return NextResponse.json({
            snappedPoint: { lat: endSnap.lat, lon: endSnap.lon },
            path: pathCoords
        });

    } catch (error: any) {
        console.error('Step API error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
