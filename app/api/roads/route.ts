import { NextRequest, NextResponse } from 'next/server';
import { fetchOSMData } from '@/lib/overpass';
import { OSMWay, OSMNode } from '@/lib/types';

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

        let osmData;
        try {
            osmData = await fetchOSMData(bufferedBbox);
        } catch (osmError: any) {
            console.error('Roads API OSM fetch error:', osmError);
            return NextResponse.json({ error: osmError.message || 'OSM data fetch failed', degraded: true }, { status: 500 });
        }

        // The OSM API fallback returns ways as node-id references without inline
        // geometry (unlike Overpass `out geom`). Build a node lookup so we can
        // reconstruct way geometry either way — otherwise the map gets 0 roads
        // whenever Overpass is unavailable.
        const nodeMap = new Map<number, [number, number]>();
        for (const elem of osmData.elements) {
            if (elem.type === 'node') {
                const n = elem as OSMNode;
                nodeMap.set(n.id, [n.lat, n.lon]);
            }
        }

        const roads: [number, number][][] = [];
        for (const elem of osmData.elements) {
            if (elem.type !== 'way') continue;
            const way = elem as OSMWay;

            // SAFETY: Filter out interstates/highways to prevent snapping to them
            const highway = way.tags?.highway;
            if (highway === 'motorway' || highway === 'trunk' || highway === 'motorway_link' || highway === 'trunk_link') {
                continue;
            }

            let path: [number, number][];
            if (way.geometry) {
                path = way.geometry.map(p => [p.lat, p.lon]);
            } else {
                path = [];
                for (const nid of way.nodes ?? []) {
                    const c = nodeMap.get(nid);
                    if (c) path.push(c);
                }
            }
            if (path.length > 1) {
                roads.push(path);
            }
        }

        const degraded = osmData.elements.length === 0;
        return NextResponse.json({ roads, degraded });

    } catch (error: any) {
        console.error('Roads API error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
