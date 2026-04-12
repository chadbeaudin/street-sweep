import { NextResponse } from 'next/server';

export async function POST(req: Request) {
    try {
        const body = await req.json();
        const { code, clientId: bodyClientId, clientSecret: bodyClientSecret } = body;

        // Advanced mode: client passes its own credentials.
        // Standard mode: fall back to server-side env vars.
        const clientId = bodyClientId?.trim() || process.env.STRAVA_CLIENT_ID;
        const clientSecret = bodyClientSecret?.trim() || process.env.STRAVA_CLIENT_SECRET;

        if (!clientId || !clientSecret || !code) {
            return NextResponse.json(
                { error: 'Missing required parameters or server configuration' },
                { status: 400 }
            );
        }

        const params = new URLSearchParams();
        params.append('client_id', clientId);
        params.append('client_secret', clientSecret);
        params.append('code', code);
        params.append('grant_type', 'authorization_code');

        const response = await fetch('https://www.strava.com/oauth/token', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: params.toString()
        });

        const data = await response.json();

        if (!response.ok) {
            console.error('Strava OAuth exchange failed:', JSON.stringify(data, null, 2));
            return NextResponse.json(
                { error: 'Strava OAuth failed', details: data },
                { status: response.status }
            );
        }

        return NextResponse.json(data);
    } catch (error: any) {
        console.error('Strava OAuth Exchange Error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
