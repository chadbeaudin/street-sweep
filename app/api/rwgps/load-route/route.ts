import { withApiMetrics, incrementMetric } from '@/lib/metrics';
import { NextResponse } from 'next/server';
import { errorResponse } from '@/lib/apiErrors';
import { z } from 'zod';
import { sessionUserId, getRwgpsToken } from '@/lib/rwgpsToken';
import { calculateElevationProfile } from '@/lib/elevation';
import { parseGpxTrack } from '@/lib/gpx';
import { fetchRouteGpx, RwgpsRouteId } from '@/lib/rwgps';
import { parseBody } from '@/lib/validation';

const Body = z.object({ routeId: RwgpsRouteId });

async function handlePOST(req: Request) {
    try {
        // Without this, anyone could drive the RideWithGPS API with the server's API key (#190).
        const userId = await sessionUserId();
        if (!userId) return NextResponse.json({ error: 'Sign in to use RideWithGPS' }, { status: 401 });
        const accessToken = await getRwgpsToken(userId);
        if (!accessToken) return NextResponse.json({ error: 'Connect RideWithGPS first' }, { status: 401 });

        const parsed = await parseBody(req, Body);
        if ('error' in parsed) return parsed.error;
        const { routeId } = parsed.data;

        const { gpx, name } = await fetchRouteGpx(accessToken, routeId);
        const coords = parseGpxTrack(gpx);
        if (coords.length < 2) {
            return NextResponse.json({ error: 'RideWithGPS route contains fewer than 2 valid coordinates' }, { status: 422 });
        }

        incrementMetric('usage.import.library');
        const lonLats = coords.map(c => [c[0], c[1]] as [number, number]);
        const elevations = coords.map(c => (c.length > 2 ? (c as [number, number, number])[2] : 0));
        const elevationProfile = calculateElevationProfile(lonLats, elevations);
        const totalDistance = elevationProfile[elevationProfile.length - 1]?.distance ?? 0;

        return NextResponse.json({
            coordinates: coords,
            elevationProfile,
            totalDistance: totalDistance.toFixed(2),
            routeName: name,
        });
    } catch (error: any) {
        return errorResponse(error, 'RideWithGPS route load error:', "Couldn't load that RideWithGPS route. Try again in a moment.");
    }
}

export const POST = withApiMetrics('POST', '/api/rwgps/load-route', handlePOST);
