import { NextResponse } from 'next/server';

export async function POST(req: Request) {
    try {
        const body = await req.json();
        const { clientId, clientSecret, code } = body;

        if (!clientId || !clientSecret || !code) {
            return NextResponse.json({ error: 'Missing required parameters' }, { status: 400 });
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
            return NextResponse.json({ error: 'Strava OAuth failed', details: data }, { status: response.status });
        }

        return NextResponse.json(data);
    } catch (error: any) {
        console.error('Strava OAuth Exchange Error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
