import { NextRequest, NextResponse } from 'next/server';
import { fetchOSMData } from '@/lib/overpass';
import { OSMWay } from '@/lib/types';

export async function POST(req: NextRequest) {
    try {
        const { bbox } = await req.json();

        if (!bbox) {
            return NextResponse.json({ error: 'Missing bbox' }, { status: 400 });
        }

        const BUFFER = 0.001; // reduced from 0.005 to mitigate 504 errors
        const bufferedBbox = {
            south: bbox.south - BUFFER,
            west: bbox.west - BUFFER,
            north: bbox.north + BUFFER,
            east: bbox.east + BUFFER
        };

        const osmData = await fetchOSMData(bufferedBbox);

        const roads: [number, number][][] = [];
        for (const elem of osmData.elements) {
            if (elem.type === 'way') {
                const way = elem as OSMWay;
                if (!way.geometry) continue;

                const path: [number, number][] = way.geometry.map(p => [p.lat, p.lon]);
                if (path.length > 1) {
                    roads.push(path);
                }
            }
        }

        return NextResponse.json({ roads });

    } catch (error: any) {
        console.error('Roads API error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
