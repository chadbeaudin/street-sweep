import { NextResponse } from 'next/server';

export async function POST(req: Request) {
    try {
        const { code } = await req.json();

        const clientId = process.env.RWGPS_OAUTH_CLIENT_ID;
        const clientSecret = process.env.RWGPS_OAUTH_CLIENT_SECRET;

        if (!clientId || !clientSecret || !code) {
            return NextResponse.json(
                { error: 'Missing required parameters or server configuration' },
                { status: 400 }
            );
        }

        // req.url's host reflects the server's own bind address (e.g. 0.0.0.0:3888) when
        // running the standalone server behind a reverse proxy (Fly.io, etc.) rather than
        // the real incoming request — the Host/X-Forwarded-* headers are the reliable source.
        const proto = req.headers.get('x-forwarded-proto') || new URL(req.url).protocol.replace(':', '');
        const host = req.headers.get('x-forwarded-host') || req.headers.get('host') || new URL(req.url).host;
        const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || `${proto}://${host}`;
        const redirectUri = `${baseUrl}/rwgps-auth`;

        const params = new URLSearchParams();
        params.append('grant_type', 'authorization_code');
        params.append('code', code);
        params.append('client_id', clientId);
        params.append('client_secret', clientSecret);
        params.append('redirect_uri', redirectUri);

        const response = await fetch('https://ridewithgps.com/oauth/token.json', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: params.toString(),
        });

        const data = await response.json();

        if (!response.ok) {
            console.error('RideWithGPS OAuth exchange failed:', JSON.stringify(data, null, 2));
            return NextResponse.json(
                { error: 'RideWithGPS OAuth failed', details: data },
                { status: response.status }
            );
        }

        return NextResponse.json({ access_token: data.access_token });
    } catch (error: any) {
        console.error('RideWithGPS OAuth Exchange Error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
