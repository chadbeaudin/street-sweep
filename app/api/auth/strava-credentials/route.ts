import { withApiMetrics } from '@/lib/metrics';
import { getSessionStravaCredentials } from '@/lib/serverStravaCredentials';
import { NextResponse } from 'next/server';

// Tells the client whether its session has a linked Strava account, without
// ever putting the actual refresh_token on the wire. The routes that need
// the token to call Strava (app/api/strava/activities, app/api/ridden-roads)
// resolve it themselves server-side via getSessionStravaCredentials when the
// client doesn't supply one -- see the security review that replaced the
// previous version of this endpoint, which returned the decrypted token.
async function handleGET() {
    const creds = await getSessionStravaCredentials();
    return NextResponse.json({ connected: !!creds }, { headers: { 'Cache-Control': 'no-store' } });
}

export const GET = withApiMetrics('GET', '/api/auth/strava-credentials', handleGET);
