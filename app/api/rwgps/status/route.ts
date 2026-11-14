import { withApiMetrics } from '@/lib/metrics';
import { NextResponse } from 'next/server';
import { sessionUserId, getRwgpsToken } from '@/lib/rwgpsToken';

// Tells the client whether RideWithGPS is connected without sending the token (#194).
async function handleGET() {
    const userId = await sessionUserId();
    const connected = !!userId && !!(await getRwgpsToken(userId));
    return NextResponse.json({ connected }, { headers: { 'Cache-Control': 'no-store' } });
}

export const GET = withApiMetrics('GET', '/api/rwgps/status', handleGET);
