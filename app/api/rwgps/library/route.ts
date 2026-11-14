import { withApiMetrics } from '@/lib/metrics';
import { NextResponse } from 'next/server';
import { errorResponse } from '@/lib/apiErrors';
import { sessionUserId, getRwgpsToken } from '@/lib/rwgpsToken';
import { listRoutes, listCollections, buildLibraryTree } from '@/lib/rwgps';

async function handlePOST() {
    try {
        // Without this, anyone could drive the RideWithGPS API with the server's API key (#190).
        const userId = await sessionUserId();
        if (!userId) return NextResponse.json({ error: 'Sign in to use RideWithGPS' }, { status: 401 });
        const accessToken = await getRwgpsToken(userId);
        if (!accessToken) return NextResponse.json({ error: 'Connect RideWithGPS first' }, { status: 401 });

        const [routes, collections] = await Promise.all([
            listRoutes(accessToken),
            listCollections(accessToken),
        ]);

        return NextResponse.json(buildLibraryTree(routes, collections));
    } catch (error: any) {
        return errorResponse(error, 'RideWithGPS library fetch error:', "Couldn't load your RideWithGPS library. Try again in a moment.");
    }
}

export const POST = withApiMetrics('POST', '/api/rwgps/library', handlePOST);
