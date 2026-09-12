import { fetchOSMData } from './overpass';
import { fetchCyclingRiddenRoads } from './strava';
import { dedupeRiddenRoads } from './riddenRoads';
import { roadsFromOSM } from './roadsFromOSM';
import { prisma } from './prisma';

const ts = () => `[${new Date().toTimeString().slice(0, 8)}]`;
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Bumped: dedupeRiddenRoads now also bridges a short (<=20m) uncovered gap
// between two covered runs mid-way through the same way, not just at its ends.
export const RIDDEN_VERSION = 7;
const TILE = 0.02; // ~2.2km tiles to gather OSM roads over the riding footprint
// Guard against a runaway precompute. Self-hosted Overpass (OVERPASS_URL) has
// no external rate limit, so this is generous — it exists to catch pathological
// cases (corrupt data, a global-spanning footprint), not typical riders.
const MAX_TILES = Number(process.env.RIDDEN_MAX_TILES ?? 5000);

interface Creds { clientId?: string; clientSecret?: string; refreshToken?: string }
export type ActivityMode = 'cycling' | 'running';

// Cycling stays on the bare athleteId key so existing cached rows keep
// matching (no DB migration needed); running gets a distinct suffixed key so
// switching modes never mixes the two activity sets in the same cache row.
export const riddenRoadsCacheKey = (athleteId: string, mode: ActivityMode) => mode === 'running' ? `${athleteId}__running` : athleteId;

export const RIDDEN_REFRESHING = new Set<string>();

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

// Shared by /api/ridden-roads (its own 24h staleness timer) and
// /api/strava/activities (fired unconditionally on a manual "Sync" so the
// visual overlay never silently drifts a day behind the ridden data routing
// already uses live -- see the Comstock Park investigation this was added
// for: the router correctly treated freshly-ridden streets as ridden well
// before the overlay's independent timer caught up, which looked like a bug
// but was really two caches on different schedules).
export async function refreshRiddenRoadsInBackground(athleteId: string, creds: Creds, mode: ActivityMode) {
    const key = riddenRoadsCacheKey(athleteId, mode);
    if (RIDDEN_REFRESHING.has(key)) return;
    RIDDEN_REFRESHING.add(key);
    try {
        console.log(`${ts()} RiddenRoads: refresh starting for ${key}`);
        const { riddenRoads } = await fetchCyclingRiddenRoads(creds, mode);
        const roads = await compute(riddenRoads);
        await prisma.riddenRoadsCache.upsert({
            where: { athleteId: key },
            create: { athleteId: key, roads: roads as any, version: RIDDEN_VERSION, refreshedAt: new Date() },
            update: { roads: roads as any, version: RIDDEN_VERSION, refreshedAt: new Date() },
        });
        console.log(`${ts()} RiddenRoads: cached ${roads.length} segments for ${key}`);
    } catch (e: any) {
        console.warn(`${ts()} RiddenRoads refresh failed for ${key}: ${e.message}`);
    } finally {
        RIDDEN_REFRESHING.delete(key);
    }
}
