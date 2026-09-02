import { NextResponse } from 'next/server';
import { fetchOSMData } from '@/lib/overpass';
import { fetchCyclingRiddenRoads, resolveAthleteId } from '@/lib/strava';
import { dedupeRiddenRoads } from '@/lib/riddenRoads';
import { roadsFromOSM } from '@/lib/roadsFromOSM';
import { prisma } from '@/lib/prisma';

const ts = () => `[${new Date().toTimeString().slice(0, 8)}]`;
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const RIDDEN_VERSION = 4; // bumped: highway=service narrowed to unpaved/trail-like surfaces only (was routing through parking lots/drive-throughs)
const FRESH_TTL_MS = 24 * 60 * 60 * 1000;
const TILE = 0.02; // ~2.2km tiles to gather OSM roads over the riding footprint
// Guard against a runaway precompute. Self-hosted Overpass (OVERPASS_URL) has
// no external rate limit, so this is generous — it exists to catch pathological
// cases (corrupt data, a global-spanning footprint), not typical riders.
const MAX_TILES = Number(process.env.RIDDEN_MAX_TILES ?? 5000);

interface Creds { clientId?: string; clientSecret?: string; refreshToken?: string }

const REFRESHING = new Set<string>();

async function compute(riddenRoads: [number, number][][]): Promise<[number, number][][]> {
    const tiles = new Set<string>();
    for (const poly of riddenRoads) for (const [lat, lon] of poly) tiles.add(`${Math.floor(lat / TILE)},${Math.floor(lon / TILE)}`);
    console.log(`${ts()} RiddenRoads: ${tiles.size} OSM tiles for ${riddenRoads.length} rides`);

    if (tiles.size > MAX_TILES) {
        throw new Error(`footprint too large (${tiles.size} tiles > ${MAX_TILES}); skipping precompute — client per-viewport dedup will handle it`);
    }

    const roads: [number, number][][] = [];
    let i = 0, failed = 0;
    for (const t of tiles) {
        const [ty, tx] = t.split(',').map(Number);
        try {
            const osm = await fetchOSMData({ south: ty * TILE, west: tx * TILE, north: (ty + 1) * TILE, east: (tx + 1) * TILE });
            roads.push(...roadsFromOSM(osm));
        } catch (e: any) {
            failed++;
            console.warn(`${ts()} RiddenRoads: tile ${t} failed: ${e.message}`);
        }
        if (++i % 25 === 0) console.log(`${ts()} RiddenRoads: fetched ${i}/${tiles.size} tiles (${failed} failed)`);
        // Small pacing delay — a full recompute (e.g. after a cache-version bump) can hit
        // hundreds/thousands of tiles back-to-back and trip the Overpass instance's own
        // rate limit (509), which cascades into blocking interactive routing for everyone
        // via the shared circuit breaker. This keeps the background job well under that.
        await delay(75);
    }

    // Don't cache a badly incomplete overlay (e.g. Overpass down) — throw so the
    // previous cache is kept and a later refresh retries.
    if (tiles.size > 0 && failed / tiles.size > 0.3) {
        throw new Error(`too many OSM tile fetches failed (${failed}/${tiles.size}); skipping persist`);
    }
    return dedupeRiddenRoads(riddenRoads, roads);
}

async function refreshInBackground(athleteId: string, creds: Creds) {
    if (REFRESHING.has(athleteId)) return;
    REFRESHING.add(athleteId);
    try {
        console.log(`${ts()} RiddenRoads: refresh starting for ${athleteId}`);
        const { riddenRoads } = await fetchCyclingRiddenRoads(creds);
        const roads = await compute(riddenRoads);
        await prisma.riddenRoadsCache.upsert({
            where: { athleteId },
            create: { athleteId, roads: roads as any, version: RIDDEN_VERSION, refreshedAt: new Date() },
            update: { roads: roads as any, version: RIDDEN_VERSION, refreshedAt: new Date() },
        });
        console.log(`${ts()} RiddenRoads: cached ${roads.length} segments for ${athleteId}`);
    } catch (e: any) {
        console.warn(`${ts()} RiddenRoads refresh failed for ${athleteId}: ${e.message}`);
    } finally {
        REFRESHING.delete(athleteId);
    }
}

export async function POST(request: Request) {
    try {
        const { stravaCredentials } = await request.json() as { stravaCredentials?: Creds };
        if (!stravaCredentials?.refreshToken) {
            return NextResponse.json({ error: 'stravaCredentials.refreshToken required' }, { status: 400 });
        }
        const athleteId = await resolveAthleteId(stravaCredentials);
        const cached = await prisma.riddenRoadsCache.findUnique({ where: { athleteId } });

        if (cached) {
            const stale = Date.now() - cached.refreshedAt.getTime() > FRESH_TTL_MS;
            const outdated = (cached.version ?? 1) < RIDDEN_VERSION;
            if (stale || outdated) refreshInBackground(athleteId, stravaCredentials);
            return NextResponse.json({
                roads: cached.roads,
                refreshedAt: cached.refreshedAt.toISOString(),
                refreshing: REFRESHING.has(athleteId),
                computing: false,
            });
        }

        refreshInBackground(athleteId, stravaCredentials);
        return NextResponse.json({ roads: [], refreshedAt: null, refreshing: true, computing: true });
    } catch (e: any) {
        console.error('RiddenRoads route error:', e);
        return NextResponse.json({ error: e.message || 'Internal Server Error' }, { status: 500 });
    }
}
