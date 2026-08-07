import { NextResponse } from 'next/server';
import { fetchOSMData } from '@/lib/overpass';
import { reverseGeocode, searchCityPolygon } from '@/lib/nominatim';
import {
    buildCoverageCells,
    cellsToMiles,
    pointInPolygon,
    polylineCentroid,
    computeRideRecords,
    RideRecords
} from '@/lib/stats';
import { resolveAthleteId, fetchCyclingRiddenRoads } from '@/lib/strava';
import { prisma } from '@/lib/prisma';

const ts = () => `[${new Date().toTimeString().slice(0, 8)}]`;

const MAX_CITIES = 5;
const FRESH_TTL_MS = 24 * 60 * 60 * 1000;

// Bump when the stats computation changes shape/semantics so cached rows
// computed by an older version are recomputed in the background on next open.
// v2: dashboard is biking-only (walks/hikes/runs excluded from every metric).
// v3: bikingStats holds name lists (drill-down) instead of bare counts.
// v4: place names reverse-geocoded in English (accept-language=en).
// v5: virtual/indoor and stationary rides excluded from the ridden set.
// v6: bikingStats levels carry parent chain for hierarchical drill-down.
// v7: records added (total distance, exploration %, longest ride, climb, active days, per-year).
const STATS_VERSION = 7;

interface CityStats {
    name: string;
    state: string | null;
    activityCount: number;
    riddenMiles: number;
    totalMiles: number;
    percent: number;
}

interface StatsPayload {
    version?: number;
    totalActivities: number;
    totalUniqueMiles: number;
    totalElevationFeet: number;
    totalDistanceMiles?: number;
    explorationPct?: number; // unique (deduped) miles / total distance ridden
    longestRideMiles?: number;
    biggestClimbFeet?: number;
    activeDays?: number;
    ridesPerYear?: RideRecords['ridesPerYear'];
    cities: CityStats[];
    bikingStats?: BikingGeographies;
}

interface BikingGeographies {
    countries: string[];
    states: { name: string; country: string }[];
    counties: { name: string; state: string; country: string }[];
    cities: { name: string; county: string | null; state: string; country: string }[];
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

const METERS_TO_FEET = 3.28084;

// Input is already cycling-only (fetchCyclingRiddenRoads is the single filter
// point), so every activity here counts toward the dashboard.
async function computeStats(riddenRoads: [number, number][][], activityElevations: number[], activityDistances: number[] = [], activityStartDates: string[] = []): Promise<StatsPayload> {
    console.log(`${ts()} Stats: computing coverage cells for ${riddenRoads.length} cycling activities`);
    const records = computeRideRecords(activityDistances, activityElevations, activityStartDates);
    const totalCells = buildCoverageCells(riddenRoads);
    const totalUniqueMiles = cellsToMiles(totalCells.size);
    const totalElevationFeet = activityElevations.reduce((sum, m) => sum + (m || 0), 0) * METERS_TO_FEET;

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

    const bucketResult = new Map<string, { city: string | null; county: string | null; state: string | null; country: string | null } | null>();
    const bucketEntries = Array.from(uniqueBuckets.entries());
    let rateLimitHits = 0;
    let bailed = false;
    for (let i = 0; i < bucketEntries.length; i++) {
        const [bucketKey, c] = bucketEntries[i];
        try {
            const r = await reverseGeocode(c[0], c[1]);
            bucketResult.set(bucketKey, { city: r.city, county: r.county, state: r.state, country: r.country });
            rateLimitHits = 0;
            if ((i + 1) % 25 === 0) {
                console.log(`${ts()} Stats: reverse-geocode progress ${i + 1}/${bucketEntries.length}`);
            }
        } catch (e: any) {
            const msg = e?.message || String(e);
            console.warn(`${ts()} reverse-geocode bucket ${bucketKey} failed: ${msg}`);
            bucketResult.set(bucketKey, null);
            if (msg.includes('429') || msg.includes('abort')) {
                rateLimitHits++;
                if (rateLimitHits >= 5) {
                    console.warn(`${ts()} Stats: bailing out of reverse-geocode after ${rateLimitHits} consecutive rate-limit/timeout errors`);
                    bailed = true;
                    break;
                }
            }
        }
    }
    console.log(`${ts()} Stats: reverse-geocoding complete (${bucketResult.size}/${bucketEntries.length} buckets resolved)`);

    // A rate-limit bail leaves geographies/cities incomplete. Throw instead of
    // returning a degraded result, so refreshInBackground skips persisting and
    // the previous good cache is preserved (a later refresh retries once the
    // Nominatim rate-limit window clears).
    if (bailed) {
        throw new Error('reverse-geocoding bailed on sustained rate-limits; skipping persist to protect cached stats');
    }

    const cityByActivity: ({ city: string | null; county: string | null; state: string | null; country: string | null } | null)[] = centroidByActivity.map(c => {
        if (!c) return null;
        const bucketKey = `${Math.round(c[0] * 20) / 20}:${Math.round(c[1] * 20) / 20}`;
        return bucketResult.get(bucketKey) ?? null;
    });

    const byCity = new Map<string, { city: string; state: string | null; country: string | null; activityIdx: number[] }>();
    for (let i = 0; i < cityByActivity.length; i++) {
        const info = cityByActivity[i];
        if (!info || !info.city) continue;
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

    // cityByActivity is already biking-only (non-biking activities were filtered
    // out at the top). Dedup each level while keeping its parent chain so the UI
    // can drill Country -> State -> County -> City.
    const countrySet = new Set<string>();
    const stateMap = new Map<string, { name: string; country: string }>();
    const countyMap = new Map<string, { name: string; state: string; country: string }>();
    const cityMap = new Map<string, { name: string; county: string | null; state: string; country: string }>();

    for (const info of cityByActivity) {
        if (!info) continue;
        const country = info.country ?? '';
        const state = info.state ?? '';
        if (info.country) countrySet.add(info.country);
        if (info.state) stateMap.set(`${state}|${country}`, { name: info.state, country });
        if (info.county) countyMap.set(`${info.county}|${state}|${country}`, { name: info.county, state, country });
        if (info.city) cityMap.set(`${info.city}|${state}|${country}`, { name: info.city, county: info.county ?? null, state, country });
    }

    const byName = <T extends { name: string }>(a: T, b: T) => a.name.localeCompare(b.name);
    const bikingStats: BikingGeographies = {
        countries: Array.from(countrySet).sort((a, b) => a.localeCompare(b)),
        states: Array.from(stateMap.values()).sort(byName),
        counties: Array.from(countyMap.values()).sort(byName),
        cities: Array.from(cityMap.values()).sort(byName),
    };

    const explorationPct = records.totalDistanceMiles > 0
        ? (totalUniqueMiles / records.totalDistanceMiles) * 100
        : 0;

    return {
        version: STATS_VERSION,
        totalActivities: riddenRoads.length,
        totalUniqueMiles,
        totalElevationFeet,
        totalDistanceMiles: records.totalDistanceMiles,
        explorationPct,
        longestRideMiles: records.longestRideMiles,
        biggestClimbFeet: records.biggestClimbFeet,
        activeDays: records.activeDays,
        ridesPerYear: records.ridesPerYear,
        cities,
        bikingStats,
    };
}
// Background recomputes are fire-and-forget; we serialize per-athlete so the
// same user doesn't trigger overlapping refreshes from rapid dialog opens.
const REFRESHING: Set<string> = new Set();

// The DB connection can intermittently reject on transient network blips.
// Retry idempotent DB ops rather than surfacing the blip to the user (reads)
// or throwing away minutes of compute (writes).
async function withDbRetry<T>(op: () => Promise<T>, label: string): Promise<T> {
    const delays = [500, 2000, 5000];
    for (let attempt = 0; attempt <= delays.length; attempt++) {
        try {
            return await op();
        } catch (e: any) {
            if (attempt === delays.length) throw e;
            console.warn(`${ts()} Stats: ${label} attempt ${attempt + 1} failed (${e?.message || e}); retrying`);
            await new Promise(r => setTimeout(r, delays[attempt]));
        }
    }
    throw new Error('unreachable');
}

async function persistStats(athleteId: string, stats: StatsPayload): Promise<void> {
    await withDbRetry(() => prisma.statsCache.upsert({
        where: { athleteId },
        create: { athleteId, stats: stats as any, refreshedAt: new Date() },
        update: { stats: stats as any, refreshedAt: new Date() }
    }), 'persist');
}

async function refreshInBackground(athleteId: string, creds: StravaCredentials) {
    if (REFRESHING.has(athleteId)) return;
    REFRESHING.add(athleteId);
    try {
        console.log(`${ts()} Stats: background refresh starting for athlete ${athleteId}`);
        // Fetch the ride set server-side so the client never has to ship it in
        // the request body (which a reverse proxy would reject as too large).
        const { riddenRoads, activityElevations, activityDistances, activityStartDates } = await fetchCyclingRiddenRoads(creds);
        const fresh = await computeStats(riddenRoads, activityElevations, activityDistances, activityStartDates);
        await persistStats(athleteId, fresh);
        console.log(`${ts()} Stats: background refresh complete for athlete ${athleteId}`);
    } catch (e: any) {
        console.warn(`${ts()} Stats: background refresh failed for ${athleteId}:`, e?.message || e);
    } finally {
        REFRESHING.delete(athleteId);
    }
}

export async function POST(request: Request) {
    try {
        const body = await request.json() as { stravaCredentials?: StravaCredentials };
        const { stravaCredentials } = body;
        if (!stravaCredentials?.refreshToken) {
            return NextResponse.json({ error: 'stravaCredentials.refreshToken required to identify athlete' }, { status: 400 });
        }

        const athleteId = await resolveAthleteId(stravaCredentials);
        const cached = await withDbRetry(() => prisma.statsCache.findUnique({ where: { athleteId } }), 'read cache');

        if (cached) {
            const ageMs = Date.now() - cached.refreshedAt.getTime();
            const stale = ageMs > FRESH_TTL_MS;
            const cachedVersion = (cached.stats as any)?.version ?? 1;
            const outdatedSchema = cachedVersion < STATS_VERSION;

            if (stale || outdatedSchema) {
                refreshInBackground(athleteId, stravaCredentials);
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
        console.log(`${ts()} Stats: cold compute kicked off for athlete ${athleteId}`);
        refreshInBackground(athleteId, stravaCredentials);
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
