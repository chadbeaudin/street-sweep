import { NextRequest, NextResponse } from 'next/server';
import { fetchOSMData } from '@/lib/overpass';
import { StreetGraph } from '@/lib/graph';

export async function POST(req: NextRequest) {
    try {
        const { point, lastPoint, bbox, manualRoute, riddenRoads, routingOptions } = await req.json();

        if (!point || !bbox) {
            return NextResponse.json({ error: 'Missing parameters' }, { status: 400 });
        }

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

        const osmData = await fetchOSMData(bufferedBbox);

        // Use the cached graph for speed. We now apply penalties dynamically
        // during pathfinding instead of mutating the graph weights.
        const graph = StreetGraph.getCachedGraph(bufferedBbox, osmData, riddenRoads || null, routingOptions);

        // Get link IDs that should be penalized (already traversed in current session)
        let penalizedLinks: Map<string, number> | undefined;
        if (manualRoute && Array.isArray(manualRoute) && manualRoute.length > 0) {
            penalizedLinks = graph.getTraversalPenalties(manualRoute, 5);
        }

        const snappedData = graph.findClosestPointOnEdge(point.lat, point.lon);
        if (!snappedData) {
            const nodeCount = graph.graph.getNodeCount();
            console.error(`[Step] Could not snap point (${point.lat.toFixed(5)}, ${point.lon.toFixed(5)}). Graph has ${nodeCount} nodes — OSM data may be unavailable.`);
            return NextResponse.json({ error: `Could not snap point to road network (${nodeCount} nodes loaded). Overpass API may be unavailable — try again shortly.` }, { status: 404 });
        }

        const snappedPoint = { lat: snappedData.lat, lon: snappedData.lon };
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
                    const r = graph.findClosestTarget(sid, endTargets, undefined, penalizedLinks);
                    if (r) { pathResult = r; usedStartId = sid; break; }
                }

                // Fallback: snap-edge targets are disconnected — try all nodes within ~550m of
                // the click point so Dijkstra can route to the nearest reachable node instead.
                if (!pathResult) {
                    const broadTargets = graph.findNodeIdsNearPoint(point.lat, point.lon, 10);
                    for (const sid of startOptions) {
                        const r = graph.findClosestTarget(sid, broadTargets, undefined, penalizedLinks);
                        if (r) { pathResult = r; usedStartId = sid; break; }
                    }
                }

                if (!pathResult || !usedStartId) {
                    console.warn(`[Step] No path found from [${startOptions.join(',')}] to [${[...endTargets].join(',')}] — graph may be disconnected here.`);
                } else {
                    const path = pathResult.path;
                    const endId = pathResult.targetId;
                    const startId = usedStartId;

                    // Start of the path: [prevSnappedPoint, startNode]
                    pathCoords.push([prevSnappedData.lon, prevSnappedData.lat]);

                    const startNode = graph.graph.getNode(startId);
                    if (startNode && (startNode.data.lat !== prevSnappedData.lat || startNode.data.lon !== prevSnappedData.lon)) {
                        pathCoords.push([startNode.data.lon, startNode.data.lat]);
                    }

                    // Middle of the path: the nodes in-between.
                    //
                    // Special case for the final hop: if the path's last edge
                    // is the snap edge containing snappedPoint, and we are
                    // approaching endId from the OTHER endpoint of that edge
                    // (i.e., from snappedData.u when endId === snappedData.v,
                    // or vice versa), then pushing endId before snappedPoint
                    // would overshoot the user's click — the polyline would
                    // travel the full edge to endId, then backtrack to
                    // snappedPoint. Instead, skip endId and let the path end
                    // exactly at snappedPoint mid-edge.
                    const otherSnapEnd =
                        endId === snappedData.u ? snappedData.v :
                        endId === snappedData.v ? snappedData.u : null;

                    for (let i = 0; i < path.length; i++) {
                        const segment = path[i];
                        const isLast = i === path.length - 1;
                        const skipEndOvershoot =
                            isLast &&
                            otherSnapEnd !== null &&
                            segment.idNext === endId &&
                            segment.id === otherSnapEnd;

                        if (skipEndOvershoot) break;

                        const n = graph.graph.getNode(segment.idNext);
                        if (n) pathCoords.push([n.data.lon, n.data.lat]);
                    }

                    // End of the path: [..., currentSnappedPoint]
                    if (pathCoords.length > 0) {
                        const lastInPath = pathCoords[pathCoords.length - 1];
                        if (lastInPath[0] !== snappedPoint.lon || lastInPath[1] !== snappedPoint.lat) {
                            pathCoords.push([snappedPoint.lon, snappedPoint.lat]);
                        }
                    }
                }
            }
        }

        return NextResponse.json({
            snappedPoint,
            path: pathCoords
        });

    } catch (error: any) {
        console.error('Step API error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
