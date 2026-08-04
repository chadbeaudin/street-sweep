import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
    const clientId = process.env.RWGPS_OAUTH_CLIENT_ID;

    if (!clientId) {
        return NextResponse.json({ error: 'RideWithGPS OAuth client ID not configured on server.' }, { status: 500 });
    }

    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || `http://${new URL(req.url).host}`;
    const redirectUri = `${baseUrl}/rwgps-auth`;

    const state = crypto.randomUUID();

    const authorizeUrl = `https://ridewithgps.com/oauth/authorize?client_id=${clientId}&response_type=code&redirect_uri=${encodeURIComponent(redirectUri)}&state=${state}`;

    const response = NextResponse.redirect(authorizeUrl);
    response.cookies.set('rwgps_oauth_state', state, {
        httpOnly: false,
        sameSite: 'lax',
        maxAge: 600,
        path: '/',
    });
    return response;
}
