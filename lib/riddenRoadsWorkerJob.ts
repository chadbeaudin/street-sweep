// The actual recompute pipeline, run only by the separate `worker` Fly
// process group (see app/api/internal/ridden-roads-tick/route.ts and
// fly.toml) -- never inline in a web-serving request. This used to run
// fire-and-forget inside the same process as web traffic and could OOM-crash
// or block the whole app's event loop for 10+ minutes (a real prod incident);
// see lib/riddenRoadsRefresh.ts's own comment for the full story.
import { prisma } from './prisma';
import { fetchOSMData } from './overpass';
import { roadsFromOSM } from './roadsFromOSM';
import { dedupeRiddenRoads, filterRiddenRoadsToBbox } from './riddenRoads';
import { fetchCyclingRiddenRoads } from './strava';
import { RIDDEN_VERSION, tileBbox, decryptJobCreds, ActivityMode } from './riddenRoadsRefresh';

const ts = () => `[${new Date().toTimeString().slice(0, 8)}]`;
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const STALE_RUNNING_MS = 5 * 60 * 1000;

type Job = NonNullable<Awaited<ReturnType<typeof claimNextJob>>>;

export async function claimNextJob() {
    const staleThreshold = new Date(Date.now() - STALE_RUNNING_MS);
    const candidate = await prisma.riddenRoadsJob.findFirst({
        where: { OR: [{ status: 'queued' }, { status: 'running', updatedAt: { lt: staleThreshold } }] },
        orderBy: { updatedAt: 'asc' },
    });
    if (!candidate) return null;

    // Optimistic claim: only succeeds if another worker tick hasn't already
    // picked it up between the find and this update.
    const claimed = await prisma.riddenRoadsJob.updateMany({
        where: { key: candidate.key, status: candidate.status },
        data: { status: 'running' },
    });
    if (claimed.count === 0) return null;
    return prisma.riddenRoadsJob.findUnique({ where: { key: candidate.key } });
}

// Padding beyond a tile's own edges to pull in GPS points/OSM ways that cross
// the boundary -- matches dedupeRiddenRoads's own 50m proximity tolerance so a
// ridden road right at a tile edge doesn't lose the samples that would prove
// it was ridden.
const TILE_MATCH_PADDING_M = 50;

async function processJob(job: Job) {
    const { key, athleteId, mode } = job;
    const pending: string[] = Array.isArray(job.tiles) ? (job.tiles as any) : [];
    console.log(`${ts()} RiddenRoads worker: starting ${key} (${pending.length} tiles pending)`);
    if (pending.length === 0) {
        await prisma.riddenRoadsJob.delete({ where: { key } });
        return;
    }
    const creds = decryptJobCreds(job.credsEncrypted);

    // Fetched once per tick, not per tile -- this is proportional to one
    // rider's own ride count, which is bounded regardless of how many tiles
    // are being (re)computed this tick.
    const { riddenRoads } = await fetchCyclingRiddenRoads(creds, mode as ActivityMode);

    let remaining = pending;
    for (const tile of pending) {
        try {
            const bbox = tileBbox(tile);
            const localRidden = filterRiddenRoadsToBbox(riddenRoads, bbox, TILE_MATCH_PADDING_M) ?? [];
            // Nothing this rider has ever done passes through this tile -- an
            // empty (but present) cache row still avoids re-fetching OSM data
            // for it on every future viewport visit.
            let deduped: [number, number][][] = [];
            if (localRidden.length > 0) {
                const osm = await fetchOSMData(bbox);
                const roads = roadsFromOSM(osm);
                deduped = dedupeRiddenRoads(localRidden, roads);
            }
            await prisma.riddenRoadsTile.upsert({
                where: { athleteKey_tile: { athleteKey: key, tile } },
                create: { athleteKey: key, tile, roads: deduped as any, version: RIDDEN_VERSION, refreshedAt: new Date() },
                update: { roads: deduped as any, version: RIDDEN_VERSION, refreshedAt: new Date() },
            });
        } catch (e: any) {
            console.warn(`${ts()} RiddenRoads worker: tile ${tile} failed, will retry next tick: ${e.message}`);
            continue; // leave it in `remaining` below for the next tick
        }
        remaining = remaining.filter(t => t !== tile);
        await prisma.riddenRoadsJob.update({ where: { key }, data: { tiles: remaining } }).catch(() => {});
        // Small pacing delay — a big viewport/route area can still be dozens of tiles,
        // and hitting Overpass back-to-back can trip its own rate limit (509), which
        // cascades into blocking interactive routing for everyone via the shared
        // circuit breaker. This keeps the worker well under that.
        await delay(75);
    }

    console.log(`${ts()} RiddenRoads worker: ${pending.length - remaining.length}/${pending.length} tiles done for ${key}`);
    if (remaining.length === 0) {
        await prisma.riddenRoadsJob.delete({ where: { key } });
    }
}

// Claims and fully processes at most one job, then returns. Called
// repeatedly by the worker machine's self-ticking loop (see
// app/api/internal/ridden-roads-tick/route.ts) -- intentionally does not loop
// internally, so each tick is one bounded, checkpointed unit of work.
export async function tickRiddenRoadsWorker(): Promise<{ processed: boolean; key?: string }> {
    const job = await claimNextJob();
    if (!job) return { processed: false };
    try {
        await processJob(job);
        return { processed: true, key: job.key };
    } catch (e: any) {
        console.warn(`${ts()} RiddenRoads worker: job ${job.key} failed: ${e.message}`);
        await prisma.riddenRoadsJob.update({ where: { key: job.key }, data: { status: 'failed', error: e.message } }).catch(() => {});
        return { processed: true, key: job.key };
    }
}
