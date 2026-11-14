import { withApiMetrics } from '@/lib/metrics';
import { NextResponse } from 'next/server';
import { errorResponse } from '@/lib/apiErrors';
import { z } from 'zod';
import { sessionUserId, getRwgpsToken } from '@/lib/rwgpsToken';
import { buildGpxCourse } from '@/lib/gpx';
import { uploadRouteToRwgps, RwgpsRouteName } from '@/lib/rwgps';
import { Route, parseBody } from '@/lib/validation';

const Body = z.object({ route: Route.min(2), name: RwgpsRouteName });

async function handlePOST(req: Request) {
    try {
        // Without this, anyone could drive the RideWithGPS API with the server's API key (#190).
        const userId = await sessionUserId();
        if (!userId) return NextResponse.json({ error: 'Sign in to use RideWithGPS' }, { status: 401 });
        const accessToken = await getRwgpsToken(userId);
        if (!accessToken) return NextResponse.json({ error: 'Connect RideWithGPS first' }, { status: 401 });

        const parsed = await parseBody(req, Body);
        if ('error' in parsed) return parsed.error;
        const { route, name } = parsed.data;

        const gpx = buildGpxCourse(route as [number, number, number?, number?][], name || 'StreetSweep Route');
        const result = await uploadRouteToRwgps(accessToken, gpx, name || 'StreetSweep Route');

        return NextResponse.json(result);
    } catch (error: any) {
        return errorResponse(error, 'RideWithGPS upload error:', "Couldn't upload the route to RideWithGPS. Try again in a moment.");
    }
}

export const POST = withApiMetrics('POST', '/api/export/rwgps', handlePOST);
