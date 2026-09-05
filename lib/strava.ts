import polyline from '@mapbox/polyline';
import { isBikingActivity, isCyclingActivity } from './stats';
import { haversineM } from './geometry';
import { prisma } from './prisma';
import { parseFtpFromComment, parseFtpFromNamedActivityComment, FtpReading } from './ftp';

// Stationary/indoor-trainer rides imported into Strava keep a fixed GPS point,
// so their track barely moves. Drop any ride whose bounding-box diagonal is
// under this — real rides (even a 0.9km Kuwait spin, ~360m span) clear it.
const MIN_TRACK_SPAN_METERS = 250;

function trackSpanMeters(poly: [number, number][]): number {
    let minLat = 90, maxLat = -90, minLon = 180, maxLon = -180;
    for (const [lat, lon] of poly) {
        if (lat < minLat) minLat = lat;
        if (lat > maxLat) maxLat = lat;
        if (lon < minLon) minLon = lon;
        if (lon > maxLon) maxLon = lon;
    }
    return haversineM(minLat, minLon, maxLat, maxLon);
}

export interface StravaActivity {
    id: number;
    name: string;
    map: {
        summary_polyline: string;
    };
    start_date: string;
    distance?: number; // meters
    total_elevation_gain?: number; // meters; Strava returns 0 if unknown
    type: string;
    sport_type?: string;
    comment_count?: number;
}

export interface RiddenActivities {
    riddenRoads: [number, number][][];
    activityElevations: number[];
    activityTypes: string[];
    activityDistances: number[]; // meters
    activityStartDates: string[]; // ISO
    // Broader than riddenRoads: also includes VirtualRide (real cycling
    // effort, no real-world GPS location) for lifetime activity/elevation
    // totals — see isCyclingActivity.
    totalCyclingActivities: number;
    totalCyclingElevationGainMeters: number;
}

// Single source of truth for what the app treats as "ridden": real-world cycling
// only. Non-cycling activities (walks/hikes/runs) and rides whose track barely
// moves (stationary/indoor trainers) are dropped here so they never reach the
// map overlay, coverage stats, or the routing ridden-penalty.
export async function fetchCyclingRiddenRoads(creds?: { clientId?: string; clientSecret?: string; refreshToken?: string }): Promise<RiddenActivities> {
    const all = await getCachedOrFetchActivities(creds);
    const real = all
        .filter(a => isBikingActivity(a.sport_type || a.type))
        .map(a => ({ a, poly: polyline.decode(a.map.summary_polyline) as [number, number][] }))
        .filter(({ poly }) => poly.length >= 2 && trackSpanMeters(poly) >= MIN_TRACK_SPAN_METERS);
    const allCycling = all.filter(a => isCyclingActivity(a.sport_type || a.type));
    return {
        riddenRoads: real.map(r => r.poly),
        activityElevations: real.map(r => r.a.total_elevation_gain ?? 0),
        activityTypes: real.map(r => r.a.sport_type || r.a.type || ''),
        activityDistances: real.map(r => r.a.distance ?? 0),
        activityStartDates: real.map(r => r.a.start_date ?? ''),
        totalCyclingActivities: allCycling.length,
        totalCyclingElevationGainMeters: allCycling.reduce((sum, a) => sum + (a.total_elevation_gain ?? 0), 0),
    };
}

export async function getStravaAccessToken(creds?: { clientId?: string; clientSecret?: string; refreshToken?: string }) {
    // Check if we received any non-empty credentials in the UI object
    const hasUICreds = !!(creds && (creds.clientId || creds.clientSecret || creds.refreshToken));

    // Use UI value if present (even if empty string, but we trim first), otherwise fallback to ENV
    const clientId = (creds?.clientId?.trim() || process.env.STRAVA_CLIENT_ID?.trim());
    const clientSecret = (creds?.clientSecret?.trim() || process.env.STRAVA_CLIENT_SECRET?.trim());
    const refreshToken = (creds?.refreshToken?.trim() || process.env.STRAVA_REFRESH_TOKEN?.trim());

    const source = hasUICreds ? 'UI' : 'ENV';
    console.log(`[Strava] Attempting token refresh. Source: ${source}, ClientID: ${clientId?.substring(0, 5)}..., Token: ${refreshToken?.substring(0, 8)}...`);

    if (!clientId || !clientSecret || !refreshToken) {
        throw new Error(`Missing Strava credentials (${source}). Please configure them in Settings or your environment variables.`);
    }

    const params = new URLSearchParams();
    params.append('client_id', clientId);
    params.append('client_secret', clientSecret);
    params.append('refresh_token', refreshToken);
    params.append('grant_type', 'refresh_token');

    const response = await fetch('https://www.strava.com/oauth/token', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: params.toString()
    });

    if (!response.ok) {
        const errorText = await response.text();
        if (errorText.trimStart().startsWith('<')) {
            throw new Error('Strava is temporarily unavailable. Please try again in a few minutes.');
        }
        let errorMessage = `Failed to refresh Strava token: ${response.status} ${response.statusText}`;
        try {
            const errorJson = JSON.parse(errorText);
            if (errorJson.message) errorMessage += ` - ${errorJson.message}`;
            if (errorJson.errors) errorMessage += ` (${JSON.stringify(errorJson.errors)})`;
        } catch {
            errorMessage += ` - ${errorText.substring(0, 200)}`;
        }
        throw new Error(errorMessage);
    }

    const data = await response.json();
    const responseKeys = Object.keys(data);
    const receivedScope = data.scope || 'NOT_RETURNED';

    console.log(`[Strava] Refresh successful. Response Keys: ${responseKeys.join(', ')}`);
    console.log(`[Strava] Scope in response: ${receivedScope}`);

    if (!data.access_token) {
        throw new Error('Strava token refresh response did not contain an access_token');
    }

    // Check for activity read permission in the scopes
    if (receivedScope !== 'NOT_RETURNED' && !receivedScope.includes('activity:read')) {
        console.warn(`[Strava] WARNING: Token refreshed but missing 'activity:read' scope. Current permitted scopes: ${receivedScope}`);
    } else if (receivedScope === 'NOT_RETURNED') {
        console.log(`[Strava] Note: No scope returned in refresh response. This usually means scopes remain unchanged.`);
    }

    return data.access_token;
}

export async function getStravaAthleteId(accessToken: string): Promise<string> {
    const res = await fetch('https://www.strava.com/api/v3/athlete', {
        headers: { 'Authorization': `Bearer ${accessToken}` }
    });
    if (!res.ok) throw new Error(`Strava /athlete failed: ${res.status}`);
    const data = await res.json();
    if (!data?.id) throw new Error('Strava /athlete response missing id');
    return String(data.id);
}

// Resolving the athlete ID costs a live Strava call (token refresh + /athlete),
// so it's cached in-process by refresh_token. Shared here rather than each
// caller keeping its own copy, so they all draw down the same in-memory cache
// instead of independently re-resolving (and re-costing rate-limit budget).
const ATHLETE_ID_CACHE = new Map<string, string>();

export async function resolveAthleteId(creds?: { clientId?: string; clientSecret?: string; refreshToken?: string }): Promise<string> {
    const cacheKey = creds?.refreshToken || '';
    if (cacheKey && ATHLETE_ID_CACHE.has(cacheKey)) return ATHLETE_ID_CACHE.get(cacheKey)!;
    const accessToken = await getStravaAccessToken(creds);
    const athleteId = await getStravaAthleteId(accessToken);
    if (cacheKey) ATHLETE_ID_CACHE.set(cacheKey, athleteId);
    return athleteId;
}

export async function fetchAllStravaActivities(creds?: { clientId?: string; clientSecret?: string; refreshToken?: string }): Promise<StravaActivity[]> {
    const accessToken = await getStravaAccessToken(creds);
    return fetchAllStravaActivitiesWithToken(accessToken);
}

async function fetchAllStravaActivitiesWithToken(accessToken: string): Promise<StravaActivity[]> {
    let page = 1;
    const perPage = 200;
    const allActivities: StravaActivity[] = [];
    let hasMore = true;

    while (hasMore) {
        const response = await fetch(`https://www.strava.com/api/v3/athlete/activities?page=${page}&per_page=${perPage}`, {
            headers: {
                'Authorization': `Bearer ${accessToken}`
            }
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error(`[Strava] Activities fetch failed. Status: ${response.status}, Body: ${errorText.substring(0, 500)}`);
            if (errorText.trimStart().startsWith('<')) {
                throw new Error('Strava is temporarily unavailable. Please try again in a few minutes.');
            }
            let errorMessage = `Strava API error: ${response.status} ${response.statusText}`;
            try {
                const errorJson = JSON.parse(errorText);
                if (errorJson.message) errorMessage += ` - ${errorJson.message}`;
                if (errorJson.errors) errorMessage += ` (${JSON.stringify(errorJson.errors)})`;
            } catch {
                errorMessage += ` - ${errorText.substring(0, 200)}`;
            }
            throw new Error(errorMessage);
        }

        const activities = await response.json() as StravaActivity[];
        if (activities.length === 0) {
            hasMore = false;
        } else {
            // Only include activities with polylines
            allActivities.push(...activities.filter(a => a.map && a.map.summary_polyline));
            page++;
        }

        // Safety limit to avoid infinite loops
        if (page > 10) hasMore = false;
    }

    return allActivities;
}

// Postgres-backed cache for the raw activity list (per athlete), so the derived
// caches (ridden-roads, stats) and the client IndexedDB cache don't each force
// their own live paginated Strava fetch. Independent of Strava's rate limit,
// which is shared application-wide across every user — see issue #61.
const ACTIVITY_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

async function getCachedOrFetchActivities(creds?: { clientId?: string; clientSecret?: string; refreshToken?: string }): Promise<StravaActivity[]> {
    // Resolving athleteId (cached) costs no live call on a warm cache, so a
    // Postgres cache hit below needs zero Strava API calls at all.
    const athleteId = await resolveAthleteId(creds);

    const cached = await prisma.stravaActivityCache.findUnique({ where: { athleteId } }).catch(() => null);
    if (cached && Date.now() - cached.syncedAt.getTime() < ACTIVITY_CACHE_TTL_MS) {
        console.log(`[Strava] Serving ${(cached.activities as unknown as StravaActivity[]).length} activities from Postgres cache for athlete ${athleteId}`);
        return cached.activities as unknown as StravaActivity[];
    }

    const accessToken = await getStravaAccessToken(creds);
    const activities = await fetchAllStravaActivitiesWithToken(accessToken);
    await prisma.stravaActivityCache.upsert({
        where: { athleteId },
        create: { athleteId, activities: activities as any, syncedAt: new Date() },
        update: { activities: activities as any, syncedAt: new Date() },
    }).catch(e => console.warn(`[Strava] Failed to persist activity cache for ${athleteId}: ${e.message}`));

    return activities;
}

// Bypasses the cache TTL check so the UI's "Sync" button can force a fresh pull.
export async function forceSyncStravaActivities(creds?: { clientId?: string; clientSecret?: string; refreshToken?: string }): Promise<void> {
    const athleteId = await resolveAthleteId(creds);
    const accessToken = await getStravaAccessToken(creds);
    const activities = await fetchAllStravaActivitiesWithToken(accessToken);
    await prisma.stravaActivityCache.upsert({
        where: { athleteId },
        create: { athleteId, activities: activities as any, syncedAt: new Date() },
        update: { activities: activities as any, syncedAt: new Date() },
    });
}

// Scans the athlete's own comments on their activities for FTP mentions (#76).
// The activity list already carries comment_count, so only activities that
// actually have comments cost an extra API call. Activities named "FTP ..."
// (e.g. "FTP Test") also get their full description checked — that field only
// comes back from the per-activity detail endpoint, so it's reserved for
// name-matched activities to avoid one detail call per activity in the history.
export async function fetchFtpReadings(creds?: { clientId?: string; clientSecret?: string; refreshToken?: string }): Promise<FtpReading[]> {
    const accessToken = await getStravaAccessToken(creds);
    const activities = await getCachedOrFetchActivities(creds);
    const authHeaders = { Authorization: `Bearer ${accessToken}` };

    const readings: FtpReading[] = [];
    for (const activity of activities) {
        const nameSignalsFtp = /ftp/i.test(activity.name);

        if (nameSignalsFtp) {
            const detailRes = await fetch(`https://www.strava.com/api/v3/activities/${activity.id}`, { headers: authHeaders });
            if (detailRes.ok) {
                const detail = await detailRes.json() as { description?: string };
                if (detail.description) {
                    const value = parseFtpFromNamedActivityComment(detail.description);
                    if (value !== null) readings.push({ value, date: activity.start_date, activityId: activity.id });
                }
            }
        }

        if ((activity.comment_count ?? 0) === 0) continue;
        const res = await fetch(`https://www.strava.com/api/v3/activities/${activity.id}/comments`, { headers: authHeaders });
        if (!res.ok) continue;
        const comments = await res.json() as { text: string }[];
        for (const comment of comments) {
            const value = nameSignalsFtp
                ? parseFtpFromNamedActivityComment(comment.text)
                : parseFtpFromComment(comment.text);
            if (value !== null) readings.push({ value, date: activity.start_date, activityId: activity.id });
        }
    }
    return readings.sort((a, b) => a.date.localeCompare(b.date));
}
