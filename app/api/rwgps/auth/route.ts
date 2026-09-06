import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
    const clientId = process.env.RWGPS_OAUTH_CLIENT_ID;

    if (!clientId) {
        return NextResponse.json({ error: 'RideWithGPS OAuth client ID not configured on server.' }, { status: 500 });
    }

    // req.url's host reflects the server's own bind address (e.g. 0.0.0.0:3888) when
    // running the standalone server behind a reverse proxy (Fly.io, etc.) rather than
    // the real incoming request — the Host/X-Forwarded-* headers are the reliable source.
    const proto = req.headers.get('x-forwarded-proto') || new URL(req.url).protocol.replace(':', '');
    const host = req.headers.get('x-forwarded-host') || req.headers.get('host') || new URL(req.url).host;
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || `${proto}://${host}`;
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
