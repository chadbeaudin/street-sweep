import { NextResponse } from 'next/server';
import { fetchOSMData } from '@/lib/overpass';
import { fetchCyclingRiddenRoads, getStravaAccessToken, getStravaAthleteId } from '@/lib/strava';
import { dedupeRiddenRoads } from '@/lib/riddenRoads';
import { OSMWay } from '@/lib/types';
import { prisma } from '@/lib/prisma';

const ts = () => `[${new Date().toTimeString().slice(0, 8)}]`;
const RIDDEN_VERSION = 1;
const FRESH_TTL_MS = 24 * 60 * 60 * 1000;
const TILE = 0.02; // ~2.2km tiles to gather OSM roads over the riding footprint
// Guard against launching a giant precompute against public Overpass. Raise this
// once a full-coverage self-hosted Overpass is in place (OVERPASS_URL).
const MAX_TILES = Number(process.env.RIDDEN_MAX_TILES ?? 500);

interface Creds { clientId?: string; clientSecret?: string; refreshToken?: string }

const ATHLETE_ID_CACHE = new Map<string, string>();
async function resolveAthleteId(creds: Creds): Promise<string> {
    const k = creds.refreshToken || '';
    if (k && ATHLETE_ID_CACHE.has(k)) return ATHLETE_ID_CACHE.get(k)!;
    const token = await getStravaAccessToken(creds);
    const id = await getStravaAthleteId(token);
    if (k) ATHLETE_ID_CACHE.set(k, id);
    return id;
}

function roadsFromOSM(data: { elements: any[] }): [number, number][][] {
    const nodeMap = new Map<number, [number, number]>();
    for (const el of data.elements) if (el.type === 'node') nodeMap.set(el.id, [el.lat, el.lon]);
    const roads: [number, number][][] = [];
    for (const el of data.elements) {
        if (el.type !== 'way') continue;
        const way = el as OSMWay;
        const hw = way.tags?.highway;
        if (hw === 'motorway' || hw === 'trunk' || hw === 'motorway_link' || hw === 'trunk_link') continue;
        let path: [number, number][];
        if (way.geometry) path = way.geometry.map(p => [p.lat, p.lon]);
        else { path = []; for (const nid of way.nodes ?? []) { const c = nodeMap.get(nid); if (c) path.push(c); } }
        if (path.length > 1) roads.push(path);
    }
    return roads;
}

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
