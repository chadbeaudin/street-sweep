import { withApiMetrics } from '@/lib/metrics';
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { z } from 'zod';
import { authOptions } from '@/lib/auth';
import { buildGpxCourse } from '@/lib/gpx';
import { uploadRouteToRwgps, RwgpsAccessToken, RwgpsRouteName } from '@/lib/rwgps';
import { Polyline, parseBody } from '@/lib/validation';

const Body = z.object({ route: Polyline.min(2), name: RwgpsRouteName, accessToken: RwgpsAccessToken });

async function handlePOST(req: Request) {
    try {
        // Without this, anyone could drive the RideWithGPS API with the server's API key (#190).
        const session = await getServerSession(authOptions);
        if (!(session?.user as { id?: string } | undefined)?.id) {
            return NextResponse.json({ error: 'Sign in to use RideWithGPS' }, { status: 401 });
        }

        const parsed = await parseBody(req, Body);
        if ('error' in parsed) return parsed.error;
        const { route, name, accessToken } = parsed.data;

        const gpx = buildGpxCourse(route as [number, number, number?][], name || 'StreetSweep Route');
        const result = await uploadRouteToRwgps(accessToken, gpx, name || 'StreetSweep Route');

        return NextResponse.json(result);
    } catch (error: any) {
        console.error('RideWithGPS upload error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

export const POST = withApiMetrics('POST', '/api/export/rwgps', handlePOST);
