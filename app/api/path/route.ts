import { NextResponse } from 'next/server';
import { fetchOSMData } from '@/lib/overpass';
import { StreetGraph } from '@/lib/graph';

export async function POST(request: Request) {
    try {
        const { start, end, bbox } = await request.json();

        if (!start || !end || !bbox) {
            return NextResponse.json({ error: 'Missing parameters' }, { status: 400 });
        }

        const osmData = await fetchOSMData(bbox);
        const graph = StreetGraph.getCachedGraph(bbox, osmData);

        const startNode = graph.findClosestNode(start.lat, start.lon);
        const endNode = graph.findClosestNode(end.lat, end.lon);

        if (!startNode || !endNode) {
            return NextResponse.json({ error: 'Could not find nearby roads' }, { status: 404 });
        }

        const path = graph.findPath(startNode, endNode);

        // Convert path to coordinates
        const coords: [number, number][] = [];
        if (path.length > 0) {
            const startPoint = graph.graph.getNode(startNode);
            if (startPoint) coords.push([startPoint.data.lon, startPoint.data.lat]);

            path.forEach(segment => {
                const node = graph.graph.getNode(segment.idNext);
                if (node) coords.push([node.data.lon, node.data.lat]);
            });
        }

        return NextResponse.json({ coordinates: coords });
    } catch (error: any) {
        console.error('Error in path API:', error);
        return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
    }
}
