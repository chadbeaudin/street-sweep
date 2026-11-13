import { withApiMetrics } from '@/lib/metrics';
import { NextResponse } from 'next/server';
import { configuredBaseUrl } from '@/lib/baseUrl';

export const dynamic = 'force-dynamic';

async function handleGET() {
    const clientId = process.env.RWGPS_OAUTH_CLIENT_ID;

    if (!clientId) {
        return NextResponse.json({ error: 'RideWithGPS OAuth client ID not configured on server.' }, { status: 500 });
    }

    const redirectUri = `${configuredBaseUrl()}/rwgps-auth`;

    const state = crypto.randomUUID();

    const authorizeUrl = `https://ridewithgps.com/oauth/authorize?client_id=${clientId}&response_type=code&redirect_uri=${encodeURIComponent(redirectUri)}&state=${state}`;

    const response = NextResponse.redirect(authorizeUrl);
    response.cookies.set('rwgps_oauth_state', state, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 600,
        path: '/',
    });
    return response;
}

export const GET = withApiMetrics('GET', '/api/rwgps/auth', handleGET);
