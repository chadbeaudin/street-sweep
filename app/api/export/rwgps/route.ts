import { withApiMetrics } from '@/lib/metrics';
import { NextResponse } from 'next/server';
import { buildGpxCourse } from '@/lib/gpx';
import { uploadRouteToRwgps } from '@/lib/rwgps';

async function handlePOST(req: Request) {
    try {
        const { route, name, accessToken } = await req.json();

        if (!route || !accessToken) {
            return NextResponse.json({ error: 'Missing required data' }, { status: 400 });
        }

        const gpx = buildGpxCourse(route, name || 'StreetSweep Route');
        const result = await uploadRouteToRwgps(accessToken, gpx, name || 'StreetSweep Route');

        return NextResponse.json(result);
    } catch (error: any) {
        console.error('RideWithGPS upload error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

export const POST = withApiMetrics('POST', '/api/export/rwgps', handlePOST);
