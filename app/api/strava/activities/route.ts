import { NextResponse } from 'next/server';
import { fetchAllStravaActivities } from '@/lib/strava';
import polyline from '@mapbox/polyline';

export async function POST(req: Request) {
    try {
        const body = await req.json();
        const { stravaCredentials } = body;

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

        const activities = await fetchAllStravaActivities(stravaCredentials);

        // Transform activities into simple coordinate arrays
        const riddenRoads = activities.map(activity => {
            const decoded = polyline.decode(activity.map.summary_polyline);
            // Strava polylines are [lat, lon], Leaflet expects [lat, lon] too.
            // But our app usually uses [lon, lat] internally for GeoJSON.
            // Let's stick to lat/lon for simplicity here as it's just for display.
            return decoded;
        });

        // Per-activity total elevation gain in meters (parallel to riddenRoads).
        const activityElevations = activities.map(a => a.total_elevation_gain ?? 0);

        return NextResponse.json({ riddenRoads, activityElevations });
    } catch (error: any) {
        console.error('Strava Fetch Error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
