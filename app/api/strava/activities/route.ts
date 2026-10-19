import { withApiMetrics } from '@/lib/metrics';
import { NextResponse } from 'next/server';
import { fetchCyclingRiddenRoads, forceSyncStravaActivities } from '@/lib/strava';
import { resolveRequestStravaCredentials } from '@/lib/serverStravaCredentials';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { creditMatchingActivities } from '@/lib/routeCredit';

async function handlePOST(req: Request) {
    try {
        const body = await req.json();
        const { forceSync, activityMode } = body;
        const mode: 'cycling' | 'running' = activityMode === 'running' ? 'running' : 'cycling';

        const stravaCredentials = await resolveRequestStravaCredentials(body.stravaCredentials);
        if (!stravaCredentials) return NextResponse.json({ error: 'Sign in with Strava first' }, { status: 401 });

        if (forceSync) {
            await forceSyncStravaActivities(stravaCredentials);
            // The matched-road overlay is now recomputed per-viewport (see
            // /api/ridden-roads), not for a rider's whole history in one shot,
            // so there's no whole-rider job to kick here -- the client's own
            // viewport-scoped effect re-requests its current tiles right after
            // a forced resync (it resets its "already fetched" tracking then).
        }
        const { riddenRoads, activityElevations, activityTypes } = await fetchCyclingRiddenRoads(stravaCredentials, mode);

        // Runs after the sync above so newly synced rides and their tracks are in the cache.
        const userId = (await getServerSession(authOptions).catch(() => null) as { user?: { id?: string } } | null)?.user?.id;
        if (userId) {
            creditMatchingActivities(userId).catch(e => console.warn(`[RouteCredit] Skipped for ${userId}: ${e.message}`));
        }

        return NextResponse.json({ riddenRoads, activityElevations, activityTypes });
    } catch (error: any) {
        console.error('Strava Fetch Error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

export const POST = withApiMetrics('POST', '/api/strava/activities', handlePOST);
