import { NextResponse } from 'next/server';
import { resolveAthleteId } from '@/lib/strava';
import {
    riddenRoadsCacheKey,
    refreshRiddenRoadsInBackground,
    getCachedRiddenTiles,
    tilesForBbox,
    MAX_TILES,
    ActivityMode,
    BBox,
} from '@/lib/riddenRoadsRefresh';
import { getSessionStravaCredentials } from '@/lib/serverStravaCredentials';

const FRESH_TTL_MS = 24 * 60 * 60 * 1000;

interface Creds { clientId?: string; clientSecret?: string; refreshToken?: string }

export async function POST(request: Request) {
    try {
        let { stravaCredentials, activityMode, bbox } = await request.json() as { stravaCredentials?: Creds; activityMode?: string; bbox?: BBox };
        if (!stravaCredentials?.refreshToken) {
            const sessionCreds = await getSessionStravaCredentials();
            if (sessionCreds) stravaCredentials = { ...stravaCredentials, ...sessionCreds };
        }
        if (!stravaCredentials?.refreshToken) {
            return NextResponse.json({ error: 'stravaCredentials.refreshToken required' }, { status: 400 });
        }
        if (!bbox) {
            return NextResponse.json({ error: 'bbox required -- only the requested viewport is matched against OSM roads' }, { status: 400 });
        }
        const mode: ActivityMode = activityMode === 'running' ? 'running' : 'cycling';
        const athleteId = await resolveAthleteId(stravaCredentials);
        const key = riddenRoadsCacheKey(athleteId, mode);

        const tiles = tilesForBbox(bbox).slice(0, MAX_TILES);
        const { roads, refreshedAt, missing } = await getCachedRiddenTiles(key, tiles, FRESH_TTL_MS);

        // We just (re-)enqueued every missing tile ourselves, so "still
        // refreshing" is exactly "is anything still missing" -- no separate
        // job-status lookup needed (and none of its enqueue-then-immediately-
        // check-status race).
        if (missing.length > 0) refreshRiddenRoadsInBackground(athleteId, stravaCredentials, mode, missing);

        return NextResponse.json({
            roads,
            refreshedAt,
            refreshing: missing.length > 0,
            computing: roads.length === 0 && missing.length > 0,
        });
    } catch (e: any) {
        console.error('RiddenRoads route error:', e);
        return NextResponse.json({ error: e.message || 'Internal Server Error' }, { status: 500 });
    }
}
