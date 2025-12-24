import { NextRequest, NextResponse } from 'next/server';
import { fetchOSMData } from '@/lib/overpass';
import { StreetGraph } from '@/lib/graph';

export async function POST(req: NextRequest) {
    try {
        const { bbox } = await req.json();

        if (!bbox) {
            return NextResponse.json({ error: 'Missing bbox' }, { status: 400 });
        }

        const osmData = await fetchOSMData(bbox);
        const graph = StreetGraph.getCachedGraph(bbox, osmData);

        // Convert the graph's link data back into simple coordinate arrays
        // We'll use the original nodes from the graph to get accurate lat/lon
        const roads: [number, number][][] = [];

        graph.graph.forEachLink((link: any) => {
            const from = graph.graph.getNode(link.fromId);
            const to = graph.graph.getNode(link.toId);
            if (from && to) {
                roads.push([
                    [from.data.lat, from.data.lon],
                    [to.data.lat, to.data.lon]
                ]);
            }
        });

        return NextResponse.json({ roads });

    } catch (error: any) {
        console.error('Roads API error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
