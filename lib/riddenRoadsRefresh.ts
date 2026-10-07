import { prisma } from './prisma';
import { encryptToken, decryptToken } from './tokenCrypto';
import type { RiddenTileRoads } from './roadTiles';

const ts = () => `[${new Date().toTimeString().slice(0, 8)}]`;

// Bumped: the v11 closest-candidate-only fix used a strict single winner with
// no tie margin, which over-corrected -- a long physical road split by OSM
// into many short way-segments could flip which segment counts as "closest"
// from one real (off-line, drifting) GPS point to the next at each bend,
// starving whichever segment lost that flip of enough matches to individually
// clear MIN_COVERED_M. A fully-ridden curvy road then rendered as a broken
// dashed line instead of one continuous stretch. dedupeRiddenRoads now credits
// every candidate within TIE_MARGIN_M of the closest one, not just the single
// strict minimum, while a genuinely different nearby road (tens of meters
// farther, not centimeters) still loses outright.
export const RIDDEN_VERSION = 12;
// Guard against one request asking for an absurd number of tiles (e.g. a
// corrupt/world-scale bbox) -- a real viewport or route-generation area is a
// handful of tiles, never thousands.
export const MAX_TILES = Number(process.env.RIDDEN_MAX_TILES ?? 400);
export const TILE = 0.02; // ~2.2km tiles -- matched-road cache granularity, and the unit fetchOSMData is called per

export interface BBox { south: number; west: number; north: number; east: number }

// Tiles a bbox (plus a small padding, matching dedupeRiddenRoads's own 50m
// tolerance) overlaps at the RIDDEN_ROADS tile grid. Scoping a recompute to
// only these tiles -- instead of a rider's entire ride history -- is the
// whole point: a ride in Europe shouldn't cost memory/compute while routing
// in Colorado. It's still shown on the map (raw, unmatched polylines are
// cheap and sent separately), just never snapped to OSM roads outside where
// someone's actually looking.
export function tilesForBbox(bbox: BBox, paddingMeters = 50): string[] {
    const M_PER_DEG_LAT = 111320;
    const padLat = paddingMeters / M_PER_DEG_LAT;
    const cosLat = Math.cos(((bbox.north + bbox.south) / 2) * Math.PI / 180);
    const padLon = paddingMeters / (M_PER_DEG_LAT * Math.max(cosLat, 0.01));
    const minTy = Math.floor((bbox.south - padLat) / TILE);
    const maxTy = Math.floor((bbox.north + padLat) / TILE);
    const minTx = Math.floor((bbox.west - padLon) / TILE);
    const maxTx = Math.floor((bbox.east + padLon) / TILE);
    const tiles: string[] = [];
    for (let ty = minTy; ty <= maxTy; ty++) {
        for (let tx = minTx; tx <= maxTx; tx++) tiles.push(`${ty},${tx}`);
    }
    return tiles;
}

// Keeps the `max` tiles closest to the bbox's center, so a zoomed-out view
// matches where the user is looking instead of whichever edge the grid
// happens to enumerate first.
export function capTilesNearCenter(tiles: string[], bbox: BBox, max: number): { tiles: string[]; truncated: boolean } {
    if (tiles.length <= max) return { tiles, truncated: false };
    const cy = (bbox.south + bbox.north) / 2 / TILE;
    const cx = (bbox.west + bbox.east) / 2 / TILE;
    const dist = (tile: string) => {
        const [ty, tx] = tile.split(',').map(Number);
        return (ty + 0.5 - cy) ** 2 + (tx + 0.5 - cx) ** 2;
    };
    return { tiles: [...tiles].sort((a, b) => dist(a) - dist(b)).slice(0, max), truncated: true };
}

export function tileBbox(tile: string): BBox {
    const [ty, tx] = tile.split(',').map(Number);
    return { south: ty * TILE, north: (ty + 1) * TILE, west: tx * TILE, east: (tx + 1) * TILE };
}

export interface Creds { clientId?: string; clientSecret?: string; refreshToken?: string }
export type ActivityMode = 'cycling' | 'running';

// Cycling stays on the bare athleteId key so existing cached rows keep
// matching (no DB migration needed); running gets a distinct suffixed key so
// switching modes never mixes the two activity sets in the same cache row.
export const riddenRoadsCacheKey = (athleteId: string, mode: ActivityMode) => mode === 'running' ? `${athleteId}__running` : athleteId;

// A crashed/killed worker leaves its job stuck at status='running' forever
// unless something notices — treat a 'running' job whose heartbeat
// (updatedAt) is this stale as abandoned and eligible to be picked back up.
const STALE_RUNNING_MS = 5 * 60 * 1000;

// Enqueues (or extends) a recompute job for the worker process (worker.ts) to
// pick up, scoped to only the given tiles -- this must stay fast and
// side-effect-light, since it's called inline from API route handlers
// (app/api/ridden-roads) and must never itself do the actual tile-fetch/dedupe
// work. That work used to run fire-and-forget in this same process, over a
// rider's ENTIRE ride history, and could OOM-crash or, worse, block the Node
// event loop for the whole app for 10+ minutes (a real prod incident) --
// moving it to an isolated worker means a crash there can never take down web
// traffic, and scoping it to just the requested tiles means the job's memory
// footprint tracks "how big is this one viewport/route" rather than "how much
// has this rider ever ridden, anywhere in the world."
export async function refreshRiddenRoadsInBackground(athleteId: string, creds: Creds, mode: ActivityMode, tiles: string[]): Promise<void> {
    if (tiles.length === 0) return;
    const key = riddenRoadsCacheKey(athleteId, mode);
    try {
        const existing = await prisma.riddenRoadsJob.findUnique({ where: { key } });
        const credsEncrypted = encryptToken(JSON.stringify(creds));
        if (!existing) {
            await prisma.riddenRoadsJob.create({ data: { key, athleteId, mode, status: 'queued', tiles, credsEncrypted } });
            console.log(`${ts()} RiddenRoads: enqueued job for ${key} (${tiles.length} tiles)`);
            return;
        }
        const stale = existing.status === 'running' && Date.now() - existing.updatedAt.getTime() > STALE_RUNNING_MS;
        const existingTiles: string[] = Array.isArray(existing.tiles) ? (existing.tiles as any) : [];
        const merged = Array.from(new Set([...existingTiles, ...tiles]));
        const newTiles = merged.length - existingTiles.length;
        if (existing.status === 'queued' || (existing.status === 'running' && !stale)) {
            if (newTiles === 0) return; // every requested tile is already pending, don't touch the running job
            await prisma.riddenRoadsJob.update({ where: { key }, data: { tiles: merged, credsEncrypted } });
            console.log(`${ts()} RiddenRoads: extended job for ${key} with ${newTiles} new tiles`);
            return;
        }
        // Job previously finished/failed/went stale -- restart it with the requested tiles.
        await prisma.riddenRoadsJob.update({ where: { key }, data: { status: 'queued', tiles, credsEncrypted, error: null } });
        console.log(`${ts()} RiddenRoads: re-enqueued job for ${key} (${tiles.length} tiles)`);
    } catch (e: any) {
        console.warn(`${ts()} RiddenRoads: failed to enqueue job for ${key}: ${e.message}`);
    }
}

// Fast status check for API routes reporting `refreshing`/`computing` to the
// client for a specific set of tiles -- a single indexed primary-key lookup,
// safe to call on every request. Only counts as "active" if the job still has
// at least one of the caller's tiles pending, so unrelated in-flight work
// elsewhere in the world doesn't make an already-cached viewport look stuck.
export async function isRiddenRoadsJobActive(key: string, tiles: string[]): Promise<boolean> {
    const job = await prisma.riddenRoadsJob.findUnique({ where: { key } });
    if (!job) return false;
    const active = job.status === 'queued' || (job.status === 'running' && Date.now() - job.updatedAt.getTime() <= STALE_RUNNING_MS);
    if (!active) return false;
    const pending: string[] = Array.isArray(job.tiles) ? (job.tiles as any) : [];
    return tiles.some(t => pending.includes(t));
}

// Reads whatever matched-road tiles are already cached for this athlete+mode
// out of the given tile list -- callers merge these into a viewport's overlay
// and enqueue a job for whichever tiles weren't found.
export async function getCachedRiddenTiles(key: string, tiles: string[], freshTtlMs: number): Promise<{ tiles: RiddenTileRoads; refreshedAt: string | null; missing: string[] }> {
    if (tiles.length === 0) return { tiles: {}, refreshedAt: null, missing: [] };
    const rows = await prisma.riddenRoadsTile.findMany({ where: { athleteKey: key, tile: { in: tiles } } });
    const found = new Set(rows.map(r => r.tile));
    const missing = tiles.filter(t => !found.has(t));
    const tileRoads: RiddenTileRoads = {};
    let oldest: Date | null = null;
    const now = Date.now();
    for (const row of rows) {
        const outdated = (row.version ?? 1) < RIDDEN_VERSION;
        const stale = now - row.refreshedAt.getTime() > freshTtlMs;
        tileRoads[row.tile] = row.roads as [number, number][][]; // still show the stale/outdated overlay while a refresh is enqueued
        if (outdated || stale) missing.push(row.tile);
        else if (!oldest || row.refreshedAt < oldest) oldest = row.refreshedAt;
    }
    return { tiles: tileRoads, refreshedAt: oldest ? oldest.toISOString() : null, missing };
}

export function decryptJobCreds(credsEncrypted: string): Creds {
    return JSON.parse(decryptToken(credsEncrypted));
}
