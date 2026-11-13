import { withApiMetrics } from '@/lib/metrics';
import { withRateLimit } from '@/lib/rateLimit';
import { NextRequest, NextResponse } from 'next/server';
import { errorResponse } from '@/lib/apiErrors';
import { fetchOSMData } from '@/lib/overpass';
import { OSMWay, OSMNode } from '@/lib/types';
import { ROAD_ENCODING, encodeRoads } from '@/lib/roadEncoding';
import { z } from 'zod';
import { BBox, parseBody } from '@/lib/validation';

const Body = z.object({ bbox: BBox, encoding: z.string().max(32).optional() });

async function handlePOST(req: NextRequest) {
    try {
        const parsed = await parseBody(req, Body);
        if ('error' in parsed) return parsed.error;
        const { bbox, encoding } = parsed.data;

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
            return errorResponse(osmError, 'Roads API OSM fetch error:', "Couldn't load map roads. Try again in a moment.", 500, { degraded: true });
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

        // Deliberately-skipped oversized requests aren't a service problem —
        // just the viewport being too big — so don't flag them as degraded.
        const degraded = osmData.elements.length === 0 && !osmData.skippedTooLarge;
        // Clients that predate encoding (an open tab during a deploy) still get plain arrays.
        if (encoding === ROAD_ENCODING) return NextResponse.json({ roads: encodeRoads(roads), encoding: ROAD_ENCODING, degraded });
        return NextResponse.json({ roads, degraded });

    } catch (error: any) {
        return errorResponse(error, 'Roads API error:', "Couldn't load map roads. Try again in a moment.");
    }
}

export const POST = withApiMetrics('POST', '/api/roads', withRateLimit('roads', handlePOST));
