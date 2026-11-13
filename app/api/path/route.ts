import { withApiMetrics } from '@/lib/metrics';
import { withRateLimit } from '@/lib/rateLimit';
import { NextResponse } from 'next/server';
import { errorResponse } from '@/lib/apiErrors';
import { fetchOSMData } from '@/lib/overpass';
import { StreetGraph } from '@/lib/graph';
import { z } from 'zod';
import { LatLon, BBox, parseBody } from '@/lib/validation';

const Body = z.object({ start: LatLon, end: LatLon, bbox: BBox });

async function handlePOST(request: Request) {
    try {
        const parsed = await parseBody(request, Body);
        if ('error' in parsed) return parsed.error;
        const { start, end, bbox } = parsed.data;

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
        return errorResponse(error, 'Error in path API:', "Couldn't find a route between those points. Try again in a moment.");
    }
}

export const POST = withApiMetrics('POST', '/api/path', withRateLimit('path', handlePOST));
