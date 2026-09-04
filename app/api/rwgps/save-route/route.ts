import { NextResponse } from 'next/server';
import { buildGpxCourse } from '@/lib/gpx';
import { uploadRouteToRwgps, deleteRwgpsRoute } from '@/lib/rwgps';

export async function POST(req: Request) {
    try {
        const { route, name, accessToken, oldRouteId } = await req.json();
        if (!route || !accessToken || !oldRouteId) {
            return NextResponse.json({ error: 'Missing required data' }, { status: 400 });
        }

        const gpx = buildGpxCourse(route, name || 'StreetSweep Route');
        // Upload the replacement first — only delete the original once the new
        // one exists, so a failed upload never loses the route.
        const result = await uploadRouteToRwgps(accessToken, gpx, name || 'StreetSweep Route');

        try {
            await deleteRwgpsRoute(accessToken, oldRouteId);
        } catch (deleteError: any) {
            console.warn('RideWithGPS old-route delete failed (new route was still created):', deleteError.message);
        }

        return NextResponse.json(result);
    } catch (error: any) {
        console.error('RideWithGPS save error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
