import { NextRequest, NextResponse } from 'next/server';
import { fetchOSMData } from '@/lib/overpass';
import { StreetGraph } from '@/lib/graph';

export async function POST(req: NextRequest) {
    try {
        const { point, lastPoint, bbox } = await req.json();

        if (!point || !bbox) {
            return NextResponse.json({ error: 'Missing parameters' }, { status: 400 });
        }

        const osmData = await fetchOSMData(bbox);
        const graph = StreetGraph.getCachedGraph(bbox, osmData);

        const snappedId = graph.findClosestNode(point.lat, point.lon);
        if (!snappedId) {
            return NextResponse.json({ error: 'Could not snap point' }, { status: 404 });
        }

        const node = graph.graph.getNode(snappedId);
        if (!node) return NextResponse.json({ error: 'Node not found' }, { status: 404 });

        const snappedPoint = { lat: node.data.lat, lon: node.data.lon };
        let pathCoords: [number, number][] = [];

        if (lastPoint) {
            const lastNodeId = graph.findClosestNode(lastPoint.lat, lastPoint.lon);
            if (lastNodeId) {
                const path = graph.findPath(lastNodeId, snappedId);
                // Convert to [[lon, lat], ...]
                pathCoords = path.map(segment => {
                    const n = graph.graph.getNode(segment.idNext);
                    return [n?.data.lon || 0, n?.data.lat || 0] as [number, number];
                });

                // Ensure the very first point is included if this is the start of a path
                const startNode = graph.graph.getNode(lastNodeId);
                if (startNode) {
                    pathCoords.unshift([startNode.data.lon, startNode.data.lat]);
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
