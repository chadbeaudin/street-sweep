import { NextResponse } from 'next/server';
import { calculateElevationProfile } from '@/lib/elevation';
import { parseGpxTrack } from '@/lib/gpx';
import { fetchRouteGpx } from '@/lib/rwgps';

export async function POST(req: Request) {
    try {
        const { accessToken, routeId } = await req.json();
        if (!accessToken || !routeId) {
            return NextResponse.json({ error: 'Missing accessToken or routeId' }, { status: 400 });
        }

        const { gpx, name } = await fetchRouteGpx(accessToken, routeId);
        const coords = parseGpxTrack(gpx);
        if (coords.length < 2) {
            return NextResponse.json({ error: 'RideWithGPS route contains fewer than 2 valid coordinates' }, { status: 422 });
        }

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
        console.error('RideWithGPS route load error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
