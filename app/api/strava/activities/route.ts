import { NextResponse } from 'next/server';
import { fetchCyclingRiddenRoads, forceSyncStravaActivities, resolveAthleteId } from '@/lib/strava';
import { refreshRiddenRoadsInBackground } from '@/lib/riddenRoadsRefresh';
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
            // A manual sync means the user explicitly wants their latest rides
            // reflected everywhere -- kick the map overlay's own recompute
            // right now instead of leaving it to catch up on its independent
            // 24h timer. Fire-and-forget: the overlay is best-effort/eventual,
            // this response doesn't wait on it.
            resolveAthleteId(stravaCredentials)
                .then(athleteId => refreshRiddenRoadsInBackground(athleteId, stravaCredentials, mode))
                .catch(e => console.warn(`[API/Strava] Could not kick ridden-roads overlay refresh: ${e.message}`));
        }
        const { riddenRoads, activityElevations, activityTypes } = await fetchCyclingRiddenRoads(stravaCredentials, mode);

        return NextResponse.json({ riddenRoads, activityElevations, activityTypes });
    } catch (error: any) {
        console.error('Strava Fetch Error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
