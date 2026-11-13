import { withApiMetrics } from '@/lib/metrics';
import { withRateLimit } from '@/lib/rateLimit';
import { NextRequest, NextResponse } from 'next/server';
import { errorResponse } from '@/lib/apiErrors';
import { fetchOSMData } from '@/lib/overpass';
import { StreetGraph } from '@/lib/graph';
import { z } from 'zod';
import { LatLon, BBox, parseBody } from '@/lib/validation';

const Body = z.object({ point: LatLon, bbox: BBox });

async function handlePOST(req: NextRequest) {
    try {
        const parsed = await parseBody(req, Body);
        if ('error' in parsed) return parsed.error;
        const { point, bbox } = parsed.data;

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
        return errorResponse(error, 'Snap error:', "Couldn't find a road near that point. Try again in a moment.");
    }
}

export const POST = withApiMetrics('POST', '/api/snap', withRateLimit('snap', handlePOST));
