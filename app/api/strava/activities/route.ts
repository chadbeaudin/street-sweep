import { NextResponse } from 'next/server';
import { fetchCyclingRiddenRoads, forceSyncStravaActivities } from '@/lib/strava';
import { getSessionStravaCredentials } from '@/lib/serverStravaCredentials';

export async function POST(req: Request) {
    try {
        const body = await req.json();
        let { stravaCredentials } = body;
        const { forceSync, activityMode } = body;
        const mode: 'cycling' | 'running' = activityMode === 'running' ? 'running' : 'cycling';

        // A Strava sign-in session doesn't send a refreshToken from the client
        // (it never leaves the server -- see lib/serverStravaCredentials.ts);
        // resolve it here instead of trusting the client to supply it.
        if (!stravaCredentials?.refreshToken) {
            const sessionCreds = await getSessionStravaCredentials();
            if (sessionCreds) stravaCredentials = { ...stravaCredentials, ...sessionCreds };
        }

        if (stravaCredentials) {
            // Trim values if they exist
            if (stravaCredentials.clientId) stravaCredentials.clientId = String(stravaCredentials.clientId).trim();
            if (stravaCredentials.clientSecret) stravaCredentials.clientSecret = String(stravaCredentials.clientSecret).trim();
            if (stravaCredentials.refreshToken) stravaCredentials.refreshToken = String(stravaCredentials.refreshToken).trim();
        }

        if (forceSync) {
            await forceSyncStravaActivities(stravaCredentials);
            // The matched-road overlay is now recomputed per-viewport (see
            // /api/ridden-roads), not for a rider's whole history in one shot,
            // so there's no whole-rider job to kick here -- the client's own
            // viewport-scoped effect re-requests its current tiles right after
            // a forced resync (it resets its "already fetched" tracking then).
        }
        const { riddenRoads, activityElevations, activityTypes } = await fetchCyclingRiddenRoads(stravaCredentials, mode);

        return NextResponse.json({ riddenRoads, activityElevations, activityTypes });
    } catch (error: any) {
        console.error('Strava Fetch Error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
