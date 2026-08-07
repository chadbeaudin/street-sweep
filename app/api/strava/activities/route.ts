import { NextResponse } from 'next/server';
import { fetchCyclingRiddenRoads, forceSyncStravaActivities } from '@/lib/strava';

export async function POST(req: Request) {
    try {
        const body = await req.json();
        const { stravaCredentials, forceSync } = body;

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

        if (forceSync) await forceSyncStravaActivities(stravaCredentials);
        const { riddenRoads, activityElevations, activityTypes } = await fetchCyclingRiddenRoads(stravaCredentials);

        return NextResponse.json({ riddenRoads, activityElevations, activityTypes });
    } catch (error: any) {
        console.error('Strava Fetch Error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
