import { NextRequest, NextResponse } from 'next/server';
import { fetchOSMData } from '@/lib/overpass';
import { StreetGraph } from '@/lib/graph';

export async function POST(req: NextRequest) {
    try {
        const { point, lastPoint, bbox, manualRoute, riddenRoads, routingOptions } = await req.json();

        if (!point || !bbox) {
            return NextResponse.json({ error: 'Missing parameters' }, { status: 400 });
        }

        const BUFFER = 0.01; // ~1km buffer for snapping and short paths
        const GRID = 0.01;   // Snap to 1km grid for extreme caching

        // Calculate the span that includes current point and last point
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
            return NextResponse.json({ error: 'Could not snap point' }, { status: 404 });
        }

        const snappedPoint = { lat: snappedData.lat, lon: snappedData.lon };
        let pathCoords: [number, number][] = [];

        if (lastPoint) {
            const prevSnappedData = graph.findClosestPointOnEdge(lastPoint.lat, lastPoint.lon);
            if (prevSnappedData) {
                // Find path between nodes. We use the closest nodes of the current and previous edge snappings.
                // To minimize path length, we could try all 4 combinations (u1->u2, u1->v2, v1->u2, v1->v2),
                // but for now, we'll just pick the single closest nodes to the click points for simplicity.
                const startCandidates = new Set([prevSnappedData.u, prevSnappedData.v]);
                const endCandidates = new Set([snappedData.u, snappedData.v]);

                const startId = graph.findClosestNode(lastPoint.lat, lastPoint.lon, startCandidates);
                const endId = graph.findClosestNode(point.lat, point.lon, endCandidates);

                if (startId && endId) {
                    const path = graph.findPath(startId, endId, undefined, penalizedLinks);

                    // Start of the path: [prevSnappedPoint, startNode]
                    pathCoords.push([prevSnappedData.lon, prevSnappedData.lat]);

                    const startNode = graph.graph.getNode(startId);
                    if (startNode && (startNode.data.lat !== prevSnappedData.lat || startNode.data.lon !== prevSnappedData.lon)) {
                        pathCoords.push([startNode.data.lon, startNode.data.lat]);
                    }

                    // Middle of the path: the nodes in-between
                    path.forEach(segment => {
                        const n = graph.graph.getNode(segment.idNext);
                        if (n) pathCoords.push([n.data.lon, n.data.lat]);
                    });

                    // End of the path: [endNode, currentSnappedPoint]
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
