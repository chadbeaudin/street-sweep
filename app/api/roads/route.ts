import { NextRequest, NextResponse } from 'next/server';
import { fetchOSMData } from '@/lib/overpass';
import { OSMWay } from '@/lib/types';

export async function POST(req: NextRequest) {
    try {
        let bbox: any;
        try {
            ({ bbox } = await req.json());
        } catch {
            return NextResponse.json({ error: 'Missing bbox' }, { status: 400 });
        }

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

                // SAFETY: Filter out interstates/highways to prevent snapping to them
                const highway = way.tags?.highway;
                if (highway === 'motorway' || highway === 'trunk' || highway === 'motorway_link' || highway === 'trunk_link') {
                    continue;
                }

                const path: [number, number][] = way.geometry.map(p => [p.lat, p.lon]);
                if (path.length > 1) {
                    roads.push(path);
                }
            }
        }

        const degraded = osmData.elements.length === 0;
        return NextResponse.json({ roads, degraded });

    } catch (error: any) {
        console.error('Roads API error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
