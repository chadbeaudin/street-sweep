import { withApiMetrics } from '@/lib/metrics';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { errorResponse } from '@/lib/apiErrors';
import { fetchRideTracks } from '@/lib/strava';
import { resolveRequestStravaCredentials } from '@/lib/serverStravaCredentials';
import { findMostCommonRide, waypointsAlong, waypointSpacingM, translateRide } from '@/lib/suggestRoute';
import { LatLon, parseBody } from '@/lib/validation';

const METERS_PER_MILE = 1609.344;

const Body = z.object({
    start: LatLon,
    activityMode: z.enum(['cycling', 'running']).optional(),
});

// "Suggest a Route" (#80): waypoints for a ride from the chosen start that feels like
// the rider's usual one. Their most common ride from near there when there is one;
// otherwise their most common ride anywhere, moved to start here (same shape and
// length, on streets they haven't ridden). The client routes them like clicked points.
async function handlePOST(request: Request) {
    try {
        const creds = await resolveRequestStravaCredentials();
        if (!creds) return NextResponse.json({ error: 'Sign in with Strava first' }, { status: 401 });

        const parsed = await parseBody(request, Body);
        if ('error' in parsed) return parsed.error;
        const { start, activityMode } = parsed.data;

        const rides = await fetchRideTracks(creds, activityMode ?? 'cycling');
        const local = findMostCommonRide(rides, start);
        const common = local ?? findMostCommonRide(rides, start, Infinity);
        if (!common) {
            return NextResponse.json({ error: 'No rides to base a suggestion on yet. Sync some rides from Strava first.' }, { status: 404 });
        }

        const { ride, timesRidden } = common;
        const poly = local ? ride.poly : translateRide(ride.poly, start);
        const waypoints = waypointsAlong(poly, waypointSpacingM(ride.distanceM));
        // Begin (and close a loop) exactly where the rider asked to start.
        const isLoop = waypoints.length > 1 && waypoints[waypoints.length - 1] === waypoints[0];
        waypoints[0] = start;
        if (isLoop) waypoints[waypoints.length - 1] = start;
        return NextResponse.json({
            waypoints,
            moved: !local,
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
