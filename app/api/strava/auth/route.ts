import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
    const clientId = process.env.STRAVA_CLIENT_ID;
    
    if (!clientId) {
        return NextResponse.json({ error: 'Strava Client ID not configured on server.' }, { status: 500 });
    }

    const url = new URL(req.url);
    const host = req.headers.get('x-forwarded-host') || req.headers.get('host') || url.host;
    const protocol = req.headers.get('x-forwarded-proto') || 'http';
    const redirectUri = `${protocol}://${host}/strava-auth`;

    const state = crypto.randomUUID();

    const stravaUrl = `https://www.strava.com/oauth/authorize?client_id=${clientId}&response_type=code&redirect_uri=${encodeURIComponent(redirectUri)}&approval_prompt=force&scope=read,activity:read&state=${state}`;

    const response = NextResponse.redirect(stravaUrl);
    response.cookies.set('strava_oauth_state', state, {
        httpOnly: false,
        sameSite: 'lax',
        maxAge: 600,
        path: '/',
    });
    return response;
}
