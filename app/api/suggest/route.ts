import { withApiMetrics } from '@/lib/metrics';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { errorResponse } from '@/lib/apiErrors';
import { fetchRideTracks } from '@/lib/strava';
import { resolveRequestStravaCredentials } from '@/lib/serverStravaCredentials';
import { findMostCommonRide, waypointsAlong, waypointSpacingM, resolveAnchor } from '@/lib/suggestRoute';
import { LatLon, parseBody } from '@/lib/validation';

const METERS_PER_MILE = 1609.344;

const Body = z.object({
    mapCenter: LatLon,
    home: LatLon.nullable().optional(),
    activityMode: z.enum(['cycling', 'running']).optional(),
});

// "Suggest a Route" (#80): waypoints along the rider's most common ride near home
// (or near the map when travelling). The client routes them like clicked points.
async function handlePOST(request: Request) {
    try {
        const creds = await resolveRequestStravaCredentials();
        if (!creds) return NextResponse.json({ error: 'Sign in with Strava first' }, { status: 401 });

        const parsed = await parseBody(request, Body);
        if ('error' in parsed) return parsed.error;
        const { mapCenter, home, activityMode } = parsed.data;

        const anchor = resolveAnchor(home ?? null, mapCenter);
        const common = findMostCommonRide(await fetchRideTracks(creds, activityMode ?? 'cycling'), anchor);
        if (!common) {
            return NextResponse.json({ error: 'No rides start near here yet, so there is nothing to base a suggestion on.' }, { status: 404 });
        }

        const { ride, timesRidden } = common;
        return NextResponse.json({
            waypoints: waypointsAlong(ride.poly, waypointSpacingM(ride.distanceM)),
            rideName: ride.name,
            rideDate: ride.startDate,
            timesRidden,
            distanceMiles: ride.distanceM / METERS_PER_MILE,
        });
    } catch (error: any) {
        return errorResponse(error, 'Suggest route error:', "Couldn't suggest a route. Try again in a moment.");
    }
}

export const POST = withApiMetrics('POST', '/api/suggest', handlePOST);
