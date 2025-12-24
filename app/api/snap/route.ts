import { NextRequest, NextResponse } from 'next/server';
import { fetchOSMData } from '@/lib/overpass';
import { StreetGraph } from '@/lib/graph';

export async function POST(req: NextRequest) {
    try {
        const { point, bbox } = await req.json();

        if (!point || !bbox) {
            return NextResponse.json({ error: 'Missing point or bbox' }, { status: 400 });
        }

        const osmData = await fetchOSMData(bbox);
        const graph = StreetGraph.getCachedGraph(bbox, osmData);

        const snappedId = graph.findClosestNode(point.lat, point.lon);
        if (!snappedId) {
            return NextResponse.json({ error: 'Could not snap point' }, { status: 404 });
        }

        const node = graph.graph.getNode(snappedId);
        if (!node) {
            return NextResponse.json({ error: 'Node not found' }, { status: 404 });
        }

        return NextResponse.json({
            lat: node.data.lat,
            lon: node.data.lon,
            id: snappedId
        });

    } catch (error: any) {
        console.error('Snap error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
