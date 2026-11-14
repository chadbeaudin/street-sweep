import { withApiMetrics } from '@/lib/metrics';
import { NextResponse } from 'next/server';
import { errorResponse } from '@/lib/apiErrors';
import { configuredBaseUrl } from '@/lib/baseUrl';
import { safeEqual } from '@/lib/secureCompare';
import { sessionUserId, saveRwgpsToken } from '@/lib/rwgpsToken';

const STATE_COOKIE = 'rwgps_oauth_state';

function readCookie(req: Request, name: string): string | undefined {
    return req.headers.get('cookie')?.split(';')
        .map(c => c.trim())
        .find(c => c.startsWith(`${name}=`))
        ?.slice(name.length + 1);
}

async function handlePOST(req: Request) {
    try {
        const userId = await sessionUserId();
        if (!userId) return NextResponse.json({ error: 'Sign in to use RideWithGPS' }, { status: 401 });

        const { code, state } = await req.json();

        const expectedState = readCookie(req, STATE_COOKIE);
        if (typeof state !== 'string' || !expectedState || !safeEqual(state, expectedState)) {
            return NextResponse.json({ error: 'Invalid state. Please try connecting again.' }, { status: 400 });
        }

        const clientId = process.env.RWGPS_OAUTH_CLIENT_ID;
        const clientSecret = process.env.RWGPS_OAUTH_CLIENT_SECRET;

        if (!clientId || !clientSecret || !code) {
            return NextResponse.json(
                { error: 'Missing required parameters or server configuration' },
                { status: 400 }
            );
        }

        const redirectUri = `${configuredBaseUrl()}/rwgps-auth`;

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
            return NextResponse.json({ error: 'Connecting to RideWithGPS failed. Try again.' }, { status: response.status });
        }

        await saveRwgpsToken(userId, data.access_token);
        const ok = NextResponse.json({ connected: true });
        ok.cookies.set(STATE_COOKIE, '', { maxAge: 0, path: '/' });
        return ok;
    } catch (error: any) {
        return errorResponse(error, 'RideWithGPS OAuth Exchange Error:', 'Connecting to RideWithGPS failed. Try again.');
    }
}

export const POST = withApiMetrics('POST', '/api/rwgps/exchange', handlePOST);
