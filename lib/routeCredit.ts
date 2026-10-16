import polyline from '@mapbox/polyline';
import { prisma } from './prisma';
import { decryptToken } from './tokenCrypto';
import { getStravaAccessToken, type StravaActivity } from './strava';
import { haversineM } from './geometry';

export const CREDIT_TEXT = 'Route created by StreetSweep';
export const STRAVA_WRITE_SCOPE = 'activity:write';

const MATCH_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const MIN_COVERAGE = 0.5;
const TOLERANCE_M = 40;
const SAMPLE_SPACING_M = 20;
const CELL_DEG = 0.0005;

type LatLon = [number, number];

function densify(line: LatLon[], spacingM: number): LatLon[] {
    if (line.length === 0) return [];
    const out: LatLon[] = [line[0]];
    for (let i = 1; i < line.length; i++) {
        const [lat1, lon1] = line[i - 1];
        const [lat2, lon2] = line[i];
        const steps = Math.ceil(haversineM(lat1, lon1, lat2, lon2) / spacingM);
        for (let s = 1; s <= steps; s++) {
            const t = s / steps;
            out.push([lat1 + (lat2 - lat1) * t, lon1 + (lon2 - lon1) * t]);
        }
    }
    return out;
}

const cellKey = (lat: number, lon: number) => `${Math.floor(lat / CELL_DEG)},${Math.floor(lon / CELL_DEG)}`;

// Fraction of the route's length that lies within TOLERANCE_M of the track.
export function routeCoverage(route: LatLon[], track: LatLon[]): number {
    const samples = densify(route, SAMPLE_SPACING_M);
    if (samples.length === 0 || track.length < 2) return 0;

    const grid = new Map<string, LatLon[]>();
    for (const p of densify(track, 10)) {
        const key = cellKey(p[0], p[1]);
        const bucket = grid.get(key);
        if (bucket) bucket.push(p); else grid.set(key, [p]);
    }

    let covered = 0;
    for (const [lat, lon] of samples) {
        const cy = Math.floor(lat / CELL_DEG);
        const cx = Math.floor(lon / CELL_DEG);
        search: for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
                for (const [tlat, tlon] of grid.get(`${cy + dy},${cx + dx}`) ?? []) {
                    if (haversineM(lat, lon, tlat, tlon) <= TOLERANCE_M) { covered++; break search; }
                }
            }
        }
    }
    return covered / samples.length;
}

export function appendCredit(description: string | null | undefined): string | null {
    const existing = description?.trim() ?? '';
    if (existing.includes(CREDIT_TEXT)) return null;
    return existing ? `${existing}\n\n${CREDIT_TEXT}` : CREDIT_TEXT;
}

export async function recordExportedRoute(userId: string, route: LatLon[]): Promise<void> {
    await prisma.exportedRoute.create({ data: { userId, polyline: polyline.encode(route) } });
}

async function activityTrack(activity: StravaActivity): Promise<LatLon[]> {
    const id = activity.id.toString();
    const stream = await prisma.stravaActivityStream.findUnique({ where: { activityId: id } });
    if (stream?.polyline) return polyline.decode(stream.polyline) as LatLon[];
    const detail = await prisma.stravaActivityDetail.findUnique({ where: { activityId: id } });
    return polyline.decode(detail?.polyline || activity.map.summary_polyline) as LatLon[];
}

async function addCreditToActivity(accessToken: string, activityId: number): Promise<boolean> {
    const url = `https://www.strava.com/api/v3/activities/${activityId}`;
    const headers = { Authorization: `Bearer ${accessToken}` };
    const res = await fetch(url, { headers });
    if (!res.ok) return false;
    const { description } = await res.json() as { description?: string | null };
    const updated = appendCredit(description);
    if (updated === null) return true;
    const put = await fetch(url, {
        method: 'PUT',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: updated }),
    });
    return put.ok;
}

// Credits each recent exported route on the first later ride that covers it.
export async function creditMatchingActivities(userId: string): Promise<number> {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user?.creditRoutesOnStrava || !user.athleteId) return 0;

    const account = await prisma.account.findFirst({ where: { userId, provider: 'strava' } });
    if (!account?.refresh_token || !account.scope?.includes(STRAVA_WRITE_SCOPE)) return 0;
    const refreshToken = decryptToken(account.refresh_token);

    const routes = await prisma.exportedRoute.findMany({
        where: { userId, creditedActivityId: null, createdAt: { gt: new Date(Date.now() - MATCH_WINDOW_MS) } },
        orderBy: { createdAt: 'asc' },
    });
    if (routes.length === 0) return 0;

    const cache = await prisma.stravaActivityCache.findUnique({ where: { athleteId: user.athleteId } });
    const activities = (cache?.activities ?? []) as unknown as StravaActivity[];
    const credited = new Set(
        (await prisma.exportedRoute.findMany({ where: { userId, creditedActivityId: { not: null } }, select: { creditedActivityId: true } }))
            .map(r => r.creditedActivityId!)
    );

    let accessToken: string | null = null;
    let count = 0;
    for (const route of routes) {
        const routeLine = polyline.decode(route.polyline) as LatLon[];
        const exportedAt = route.createdAt.getTime();
        const candidates = activities
            .filter(a => !credited.has(a.id.toString()))
            .filter(a => {
                const start = Date.parse(a.start_date);
                return start >= exportedAt && start - exportedAt <= MATCH_WINDOW_MS;
            })
            .sort((a, b) => Date.parse(a.start_date) - Date.parse(b.start_date));

        for (const activity of candidates) {
            if (routeCoverage(routeLine, await activityTrack(activity)) < MIN_COVERAGE) continue;
            const token = (accessToken ??= await getStravaAccessToken({ refreshToken }));
            if (!(await addCreditToActivity(token, activity.id))) continue;
            await prisma.exportedRoute.update({ where: { id: route.id }, data: { creditedActivityId: activity.id.toString() } });
            credited.add(activity.id.toString());
            count++;
            break;
        }
    }
    return count;
}
