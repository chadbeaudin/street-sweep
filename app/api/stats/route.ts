import { NextResponse } from 'next/server';
import { fetchOSMData } from '@/lib/overpass';
import { reverseGeocode, searchCityPolygon } from '@/lib/nominatim';
import {
    buildCoverageCells,
    cellsToMiles,
    pointInPolygon,
    polylineCentroid
} from '@/lib/stats';
import { getStravaAccessToken, getStravaAthleteId } from '@/lib/strava';
import { prisma } from '@/lib/prisma';

const ts = () => `[${new Date().toTimeString().slice(0, 8)}]`;

const MAX_CITIES = 5;
const FRESH_TTL_MS = 24 * 60 * 60 * 1000;

interface CityStats {
    name: string;
    state: string | null;
    activityCount: number;
    riddenMiles: number;
    totalMiles: number;
    percent: number;
}

interface StatsPayload {
    totalActivities: number;
    totalUniqueMiles: number;
    cities: CityStats[];
}

interface StatsResponse extends Partial<StatsPayload> {
    refreshedAt: string | null;
    stale: boolean;
    refreshing: boolean;
    computing: boolean;
}

interface StravaCredentials {
    clientId?: string;
    clientSecret?: string;
    refreshToken?: string;
}

// Resolving the Strava athlete ID requires a token refresh + /athlete call.
// Cache the lookup by refresh_token so repeat hits in the same process skip it.
const ATHLETE_ID_CACHE = new Map<string, string>();

async function resolveAthleteId(creds: StravaCredentials): Promise<string> {
    const cacheKey = creds.refreshToken || '';
    if (cacheKey && ATHLETE_ID_CACHE.has(cacheKey)) return ATHLETE_ID_CACHE.get(cacheKey)!;
    const accessToken = await getStravaAccessToken(creds);
    const id = await getStravaAthleteId(accessToken);
    if (cacheKey) ATHLETE_ID_CACHE.set(cacheKey, id);
    return id;
}

function networkPolylinesFromOSM(data: { elements: any[] }): [number, number][][] {
    const nodeMap = new Map<number, { lat: number; lon: number }>();
    for (const el of data.elements) {
        if (el.type === 'node') nodeMap.set(el.id, { lat: el.lat, lon: el.lon });
    }
    const polylines: [number, number][][] = [];
    for (const el of data.elements) {
        if (el.type !== 'way' || !el.nodes) continue;
        const poly: [number, number][] = [];
        if (el.geometry) {
            for (const g of el.geometry) poly.push([g.lat, g.lon]);
        } else {
            for (const nid of el.nodes) {
                const n = nodeMap.get(nid);
                if (n) poly.push([n.lat, n.lon]);
            }
        }
        if (poly.length >= 2) polylines.push(poly);
    }
    return polylines;
}

function filterCellsByPolygon(cells: Set<string>, polygon: [number, number][]): Set<string> {
    const CELL_METERS = 15;
    const DEG_PER_METER = 1 / 111320;
    const CELL_DEG = CELL_METERS * DEG_PER_METER;
    const out = new Set<string>();
    for (const key of cells) {
        const [cLat, cLon] = key.split(':').map(Number);
        const lat = (cLat + 0.5) * CELL_DEG;
        const lon = (cLon + 0.5) * CELL_DEG;
        if (pointInPolygon(lat, lon, polygon)) out.add(key);
    }
    return out;
}

async function computeStats(riddenRoads: [number, number][][]): Promise<StatsPayload> {
    console.log(`${ts()} Stats: computing coverage cells for ${riddenRoads.length} activities`);
    const totalCells = buildCoverageCells(riddenRoads);
    const totalUniqueMiles = cellsToMiles(totalCells.size);

    // Dedupe centroids to ~5km buckets BEFORE hitting Nominatim. With 800+
    // activities concentrated in one metro area this collapses to <20 lookups
    // instead of one per activity (which would take ~15 min at 1 req/sec).
    const centroidByActivity = riddenRoads.map(polylineCentroid);
    const uniqueBuckets = new Map<string, [number, number]>();
    for (const c of centroidByActivity) {
        if (!c) continue;
        // Same 5km quantization that lib/nominatim uses for its cache key.
        const bucketKey = `${Math.round(c[0] * 20) / 20}:${Math.round(c[1] * 20) / 20}`;
        if (!uniqueBuckets.has(bucketKey)) uniqueBuckets.set(bucketKey, c);
    }
    console.log(`${ts()} Stats: ${uniqueBuckets.size} unique ~5km buckets to reverse-geocode`);

    const bucketResult = new Map<string, { city: string; state: string | null; country: string | null } | null>();
    for (const [bucketKey, c] of uniqueBuckets) {
        try {
            const r = await reverseGeocode(c[0], c[1]);
            bucketResult.set(bucketKey, r.city ? { city: r.city, state: r.state, country: r.country } : null);
        } catch (e) {
            console.warn(`${ts()} reverse-geocode failed:`, e);
            bucketResult.set(bucketKey, null);
        }
    }
    console.log(`${ts()} Stats: reverse-geocoding complete`);

    const cityByActivity: ({ city: string; state: string | null; country: string | null } | null)[] = centroidByActivity.map(c => {
        if (!c) return null;
        const bucketKey = `${Math.round(c[0] * 20) / 20}:${Math.round(c[1] * 20) / 20}`;
        return bucketResult.get(bucketKey) ?? null;
    });

    const byCity = new Map<string, { city: string; state: string | null; country: string | null; activityIdx: number[] }>();
    for (let i = 0; i < cityByActivity.length; i++) {
        const info = cityByActivity[i];
        if (!info) continue;
        const key = `${info.city}|${info.state ?? ''}|${info.country ?? ''}`;
        let entry = byCity.get(key);
        if (!entry) { entry = { city: info.city, state: info.state, country: info.country, activityIdx: [] }; byCity.set(key, entry); }
        entry.activityIdx.push(i);
    }

    const topCities = Array.from(byCity.values())
        .sort((a, b) => b.activityIdx.length - a.activityIdx.length)
        .slice(0, MAX_CITIES);

    const cities: CityStats[] = [];
    for (const entry of topCities) {
        try {
            const cityPoly = await searchCityPolygon(entry.city, entry.state, entry.country);
            if (!cityPoly) {
                cities.push({ name: entry.city, state: entry.state, activityCount: entry.activityIdx.length, riddenMiles: 0, totalMiles: 0, percent: 0 });
                continue;
            }

            console.log(`${ts()} Stats: fetching road network for ${entry.city} (bbox ${JSON.stringify(cityPoly.bbox)})`);
            const cityOSM = await fetchOSMData(cityPoly.bbox);
            const networkPolys = networkPolylinesFromOSM(cityOSM);

            const insidePolys = networkPolys.filter(p => {
                const mid = p[Math.floor(p.length / 2)];
                return pointInPolygon(mid[0], mid[1], cityPoly.polygon);
            });
            const totalNetCells = buildCoverageCells(insidePolys);
            const totalMiles = cellsToMiles(totalNetCells.size);

            const cityRiddenCells = filterCellsByPolygon(totalCells, cityPoly.polygon);
            const riddenInCity = new Set<string>();
            for (const k of cityRiddenCells) if (totalNetCells.has(k)) riddenInCity.add(k);
            const riddenMiles = cellsToMiles(riddenInCity.size);

            const percent = totalMiles > 0 ? (riddenMiles / totalMiles) * 100 : 0;
            cities.push({ name: entry.city, state: entry.state, activityCount: entry.activityIdx.length, riddenMiles, totalMiles, percent });
        } catch (e: any) {
            console.warn(`${ts()} city stats failed for ${entry.city}:`, e?.message || e);
            cities.push({ name: entry.city, state: entry.state, activityCount: entry.activityIdx.length, riddenMiles: 0, totalMiles: 0, percent: 0 });
        }
    }

    return { totalActivities: riddenRoads.length, totalUniqueMiles, cities };
}

// Background recomputes are fire-and-forget; we serialize per-athlete so the
// same user doesn't trigger overlapping refreshes from rapid dialog opens.
const REFRESHING: Set<string> = new Set();

async function refreshInBackground(athleteId: string, riddenRoads: [number, number][][]) {
    if (REFRESHING.has(athleteId)) return;
    REFRESHING.add(athleteId);
    try {
        console.log(`${ts()} Stats: background refresh starting for athlete ${athleteId}`);
        const fresh = await computeStats(riddenRoads);
        await prisma.statsCache.upsert({
            where: { athleteId },
            create: { athleteId, stats: fresh as any, refreshedAt: new Date() },
            update: { stats: fresh as any, refreshedAt: new Date() }
        });
        console.log(`${ts()} Stats: background refresh complete for athlete ${athleteId}`);
    } catch (e: any) {
        console.warn(`${ts()} Stats: background refresh failed for ${athleteId}:`, e?.message || e);
    } finally {
        REFRESHING.delete(athleteId);
    }
}

export async function POST(request: Request) {
    try {
        const body = await request.json() as { riddenRoads?: [number, number][][]; stravaCredentials?: StravaCredentials };
        const { riddenRoads, stravaCredentials } = body;
        if (!Array.isArray(riddenRoads)) {
            return NextResponse.json({ error: 'riddenRoads must be an array' }, { status: 400 });
        }
        if (!stravaCredentials?.refreshToken) {
            return NextResponse.json({ error: 'stravaCredentials.refreshToken required to identify athlete' }, { status: 400 });
        }

        const athleteId = await resolveAthleteId(stravaCredentials);
        const cached = await prisma.statsCache.findUnique({ where: { athleteId } });

        if (cached) {
            const ageMs = Date.now() - cached.refreshedAt.getTime();
            const stale = ageMs > FRESH_TTL_MS;
            if (stale) {
                // Fire-and-forget; do not await
                refreshInBackground(athleteId, riddenRoads);
            }
            const payload = cached.stats as unknown as StatsPayload;
            const response: StatsResponse = {
                ...payload,
                refreshedAt: cached.refreshedAt.toISOString(),
                stale,
                refreshing: REFRESHING.has(athleteId),
                computing: false
            };
            return NextResponse.json(response);
        }

        // No cache — kick off the computation in the background and return
        // immediately. The client polls /api/stats until cached data appears
        // so the dialog never blocks on a multi-minute cold compute.
        console.log(`${ts()} Stats: cold compute kicked off for athlete ${athleteId} (${riddenRoads.length} activities)`);
        refreshInBackground(athleteId, riddenRoads);
        const response: StatsResponse = {
            refreshedAt: null,
            stale: false,
            refreshing: true,
            computing: true
        };
        return NextResponse.json(response);
    } catch (error: any) {
        console.error('Stats route error:', error);
        return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
    }
}
