import { NextResponse } from 'next/server';
import { fetchAllStravaActivities } from '@/lib/strava';
import polyline from '@mapbox/polyline';

export async function POST(req: Request) {
    try {
        const body = await req.json();
        const { stravaCredentials } = body;

        const activities = await fetchAllStravaActivities(stravaCredentials);

        // Transform activities into simple coordinate arrays
        const riddenRoads = activities.map(activity => {
            const decoded = polyline.decode(activity.map.summary_polyline);
            // Strava polylines are [lat, lon], Leaflet expects [lat, lon] too.
            // But our app usually uses [lon, lat] internally for GeoJSON.
            // Let's stick to lat/lon for simplicity here as it's just for display.
            return decoded;
        });

        return NextResponse.json({ riddenRoads });
    } catch (error: any) {
        console.error('Strava Fetch Error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
