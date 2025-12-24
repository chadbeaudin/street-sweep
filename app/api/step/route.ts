import { NextRequest, NextResponse } from 'next/server';
import { fetchOSMData } from '@/lib/overpass';
import { StreetGraph } from '@/lib/graph';

export async function POST(req: NextRequest) {
    try {
        const { point, lastPoint, bbox } = await req.json();

        if (!point || !bbox) {
            return NextResponse.json({ error: 'Missing parameters' }, { status: 400 });
        }

        const BUFFER = 0.005; // ~500m buffer
        const bufferedBbox = {
            south: bbox.south - BUFFER,
            west: bbox.west - BUFFER,
            north: bbox.north + BUFFER,
            east: bbox.east + BUFFER
        };

        const osmData = await fetchOSMData(bufferedBbox);
        const graph = StreetGraph.getCachedGraph(bufferedBbox, osmData);

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
                    const path = graph.findPath(startId, endId);

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
