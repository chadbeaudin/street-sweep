import { NextResponse } from 'next/server';
import { resolveAthleteId } from '@/lib/strava';
import { prisma } from '@/lib/prisma';
import { RIDDEN_VERSION, riddenRoadsCacheKey, refreshRiddenRoadsInBackground, isRiddenRoadsJobActive, ActivityMode } from '@/lib/riddenRoadsRefresh';
import { getSessionStravaCredentials } from '@/lib/serverStravaCredentials';

const FRESH_TTL_MS = 24 * 60 * 60 * 1000;

interface Creds { clientId?: string; clientSecret?: string; refreshToken?: string }

export async function POST(request: Request) {
    try {
        let { stravaCredentials, activityMode } = await request.json() as { stravaCredentials?: Creds; activityMode?: string };
        if (!stravaCredentials?.refreshToken) {
            const sessionCreds = await getSessionStravaCredentials();
            if (sessionCreds) stravaCredentials = { ...stravaCredentials, ...sessionCreds };
        }
        if (!stravaCredentials?.refreshToken) {
            return NextResponse.json({ error: 'stravaCredentials.refreshToken required' }, { status: 400 });
        }
        const mode: ActivityMode = activityMode === 'running' ? 'running' : 'cycling';
        const athleteId = await resolveAthleteId(stravaCredentials);
        const key = riddenRoadsCacheKey(athleteId, mode);
        const cached = await prisma.riddenRoadsCache.findUnique({ where: { athleteId: key } });

        if (cached) {
            const stale = Date.now() - cached.refreshedAt.getTime() > FRESH_TTL_MS;
            const outdated = (cached.version ?? 1) < RIDDEN_VERSION;
            if (stale || outdated) refreshRiddenRoadsInBackground(athleteId, stravaCredentials, mode);
            return NextResponse.json({
                roads: cached.roads,
                refreshedAt: cached.refreshedAt.toISOString(),
                refreshing: await isRiddenRoadsJobActive(key),
                computing: false,
            });
        }

        refreshRiddenRoadsInBackground(athleteId, stravaCredentials, mode);
        return NextResponse.json({ roads: [], refreshedAt: null, refreshing: true, computing: true });
    } catch (e: any) {
        console.error('RiddenRoads route error:', e);
        return NextResponse.json({ error: e.message || 'Internal Server Error' }, { status: 500 });
    }
}
