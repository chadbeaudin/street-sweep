import { withApiMetrics } from '@/lib/metrics';
import { NextResponse } from 'next/server';
import { errorResponse } from '@/lib/apiErrors';
import { featureFlags } from '@/lib/featureFlags';
import { stravaFetch } from '@/lib/stravaApi';

async function handlePOST(req: Request) {
    try {
        // Only the advanced own-Strava-app flow exchanges codes here; everyone else
        // connects Strava by signing in (#126), which never hands the client a token.
        if (!featureFlags.advancedStravaIntegration) {
            return NextResponse.json({ error: 'Not found' }, { status: 404 });
        }
        const body = await req.json();
        const { code } = body;
        const clientId = body.clientId?.trim();
        const clientSecret = body.clientSecret?.trim();

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

        const response = await stravaFetch('https://www.strava.com/oauth/token', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: params.toString()
        });

        const data = await response.json();

        if (!response.ok) {
            console.error('Strava OAuth exchange failed:', JSON.stringify(data, null, 2));
            return NextResponse.json({ error: 'Connecting to Strava failed. Try again.' }, { status: response.status });
        }

        return NextResponse.json({ refresh_token: data.refresh_token });
    } catch (error: any) {
        return errorResponse(error, 'Strava OAuth Exchange Error:', 'Connecting to Strava failed. Try again.');
    }
}

export const POST = withApiMetrics('POST', '/api/strava/exchange', handlePOST);
