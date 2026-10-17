import { withApiMetrics } from '@/lib/metrics';
import { NextResponse } from 'next/server';
import { resolveAthleteId } from '@/lib/strava';
import { prisma } from '@/lib/prisma';
import { getSessionStravaCredentials } from '@/lib/serverStravaCredentials';
import { enqueueAthleteSync, hasPendingSync } from '@/lib/athleteSyncQueue';
import { STATS_VERSION, StatsPayload, statsCacheKey, withDbRetry } from '@/lib/statsCompute';
import type { ActivityMode, Creds } from '@/lib/riddenRoadsRefresh';

// Stats are recomputed by the worker whenever the athlete's activity list
// changes (#118), so this only backstops what that can't see: city road
// networks drifting in OSM over time.
const SAFETY_TTL_MS = 7 * 24 * 60 * 60 * 1000;

interface StatsResponse extends Partial<StatsPayload> {
    refreshedAt: string | null;
    stale: boolean;
    refreshing: boolean;
    computing: boolean;
}

// A fast read of the worker-computed row: never computes in this process.
async function handlePOST(request: Request) {
    try {
        const body = await request.json() as { stravaCredentials?: Creds; activityMode?: string };
        let { stravaCredentials } = body;
        if (!stravaCredentials?.refreshToken) {
            const sessionCreds = await getSessionStravaCredentials();
            if (sessionCreds) stravaCredentials = { ...stravaCredentials, ...sessionCreds };
        }
        if (!stravaCredentials?.refreshToken) {
            return NextResponse.json({ error: 'stravaCredentials.refreshToken required to identify athlete' }, { status: 400 });
        }
        const mode: ActivityMode = body.activityMode === 'running' ? 'running' : 'cycling';

        const athleteId = await resolveAthleteId(stravaCredentials);
        const cached = await withDbRetry(() => prisma.statsCache.findUnique({ where: { athleteId: statsCacheKey(athleteId, mode) } }), 'read cache');

        const outdated = !!cached && ((cached.stats as unknown as StatsPayload)?.version ?? 1) < STATS_VERSION;
        const expired = !!cached && Date.now() - cached.refreshedAt.getTime() > SAFETY_TTL_MS;
        let refreshing = await hasPendingSync(athleteId);
        if (!refreshing && (!cached || outdated || expired)) {
            await enqueueAthleteSync(athleteId, 'recompute', { mode, creds: stravaCredentials });
            refreshing = true;
        }

        const response: StatsResponse = cached
            ? { ...(cached.stats as unknown as StatsPayload), refreshedAt: cached.refreshedAt.toISOString(), stale: outdated || expired, refreshing, computing: false }
            : { refreshedAt: null, stale: false, refreshing, computing: true };
        return NextResponse.json(response);
    } catch (error: any) {
        console.error('Stats route error:', error);
        return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
    }
}

export const POST = withApiMetrics('POST', '/api/stats', handlePOST);
