import { withApiMetrics } from '@/lib/metrics';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { errorResponse } from '@/lib/apiErrors';
import { fetchRideTracks } from '@/lib/strava';
import { resolveRequestStravaCredentials } from '@/lib/serverStravaCredentials';
import { findTypicalRide } from '@/lib/suggestRoute';
import { parseBody } from '@/lib/validation';

const Body = z.object({ activityMode: z.enum(['cycling', 'running']).optional() });

// The typical ride a suggestion will aim for (#237), so the page can say what it's
// planning while /api/suggest builds the loop.
async function handlePOST(request: Request) {
    try {
        const creds = await resolveRequestStravaCredentials();
        if (!creds) return NextResponse.json({ error: 'Sign in with Strava first' }, { status: 401 });

        const parsed = await parseBody(request, Body);
        if ('error' in parsed) return parsed.error;

        const ride = findTypicalRide(await fetchRideTracks(creds, parsed.data.activityMode ?? 'cycling'));
        if (!ride) return NextResponse.json({ error: 'No rides to base a suggestion on yet.' }, { status: 404 });
        return NextResponse.json({ distanceM: ride.distanceM, elevationGainM: ride.elevationGainM });
    } catch (error: any) {
        return errorResponse(error, 'Suggest target error:', "Couldn't find your typical ride.");
    }
}

export const POST = withApiMetrics('POST', '/api/suggest/target', handlePOST);
