import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
    const clientId = process.env.STRAVA_CLIENT_ID;
    
    if (!clientId) {
        return NextResponse.json({ error: 'Strava Client ID not configured on server.' }, { status: 500 });
    }

    const url = new URL(req.url);
    const redirectUri = `${url.protocol}//${url.host}/strava-auth`;

    const stravaUrl = `https://www.strava.com/oauth/authorize?client_id=${clientId}&response_type=code&redirect_uri=${encodeURIComponent(redirectUri)}&approval_prompt=force&scope=read,activity:read`;

    return NextResponse.redirect(stravaUrl);
}
