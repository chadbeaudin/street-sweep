import { NextResponse } from 'next/server';
import { fetchCyclingRiddenRoads, forceSyncStravaActivities, resolveAthleteId } from '@/lib/strava';
import { refreshRiddenRoadsInBackground } from '@/lib/riddenRoadsRefresh';

export async function POST(req: Request) {
    try {
        const body = await req.json();
        const { stravaCredentials, forceSync, activityMode } = body;
        const mode: 'cycling' | 'running' = activityMode === 'running' ? 'running' : 'cycling';

        if (stravaCredentials) {
            console.log(`[API/Strava] Received credentials in request. Keys: ${Object.keys(stravaCredentials).join(', ')}`);
            // Trim values if they exist
            if (stravaCredentials.clientId) stravaCredentials.clientId = String(stravaCredentials.clientId).trim();
            if (stravaCredentials.clientSecret) stravaCredentials.clientSecret = String(stravaCredentials.clientSecret).trim();
            if (stravaCredentials.refreshToken) stravaCredentials.refreshToken = String(stravaCredentials.refreshToken).trim();

            console.log(`[API/Strava] ClientID provided: ${stravaCredentials.clientId?.substring(0, 5)}...`);
        } else {
            console.log('[API/Strava] No credentials in request body, will fallback to server-side ENV.');
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
