// The actual recompute pipeline, run only by the separate `worker` Fly
// process group (see app/api/internal/ridden-roads-tick/route.ts and
// fly.toml) -- never inline in a web-serving request. This used to run
// fire-and-forget inside the same process as web traffic and could OOM-crash
// or block the whole app's event loop for 10+ minutes (a real prod incident);
// see lib/riddenRoadsRefresh.ts's own comment for the full story.
import { prisma } from './prisma';
import { fetchOSMData } from './overpass';
import { roadsFromOSM } from './roadsFromOSM';
import { dedupeRiddenRoads } from './riddenRoads';
import { fetchCyclingRiddenRoads } from './strava';
import { RIDDEN_VERSION, TILE, MAX_TILES, decryptJobCreds, ActivityMode } from './riddenRoadsRefresh';

const ts = () => `[${new Date().toTimeString().slice(0, 8)}]`;
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const CHECKPOINT_EVERY = 25;
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

async function processJob(job: Job) {
    const { key, athleteId, mode } = job;
    console.log(`${ts()} RiddenRoads worker: starting ${key} (resuming from ${job.tilesDone} tiles)`);
    const creds = decryptJobCreds(job.credsEncrypted);

    const { riddenRoads } = await fetchCyclingRiddenRoads(creds, mode as ActivityMode);

    const tileSet = new Set<string>();
    for (const poly of riddenRoads) for (const [lat, lon] of poly) tileSet.add(`${Math.floor(lat / TILE)},${Math.floor(lon / TILE)}`);
    const tileList = Array.from(tileSet).sort();
    console.log(`${ts()} RiddenRoads worker: ${tileList.length} OSM tiles for ${riddenRoads.length} rides`);

    if (tileList.length > MAX_TILES) {
        throw new Error(`footprint too large (${tileList.length} tiles > ${MAX_TILES}); skipping precompute`);
    }

    // Resume from the last checkpoint rather than re-fetching tiles already
    // accumulated in a previous, interrupted attempt at this same job.
    const roads: [number, number][][] = Array.isArray(job.partialRoads) ? (job.partialRoads as any) : [];
    let failed = 0;
    for (let i = job.tilesDone; i < tileList.length; i++) {
        const [ty, tx] = tileList[i].split(',').map(Number);
        try {
            const osm = await fetchOSMData({ south: ty * TILE, west: tx * TILE, north: (ty + 1) * TILE, east: (tx + 1) * TILE });
            roads.push(...roadsFromOSM(osm));
        } catch (e: any) {
            failed++;
            console.warn(`${ts()} RiddenRoads worker: tile ${tileList[i]} failed: ${e.message}`);
        }
        const doneCount = i + 1;
        if (doneCount % CHECKPOINT_EVERY === 0 || doneCount === tileList.length) {
            console.log(`${ts()} RiddenRoads worker: fetched ${doneCount}/${tileList.length} tiles (${failed} failed)`);
            await prisma.riddenRoadsJob.update({
                where: { key },
                data: { tilesDone: doneCount, tilesTotal: tileList.length, partialRoads: roads as any },
            });
        }
        // Small pacing delay — a full recompute (e.g. after a cache-version bump) can hit
        // hundreds/thousands of tiles back-to-back and trip the Overpass instance's own
        // rate limit (509), which cascades into blocking interactive routing for everyone
        // via the shared circuit breaker. This keeps the worker well under that.
        await delay(75);
    }

    if (tileList.length > 0 && failed / tileList.length > 0.3) {
        throw new Error(`too many OSM tile fetches failed (${failed}/${tileList.length}); skipping persist`);
    }

    const deduped = dedupeRiddenRoads(riddenRoads, roads);
    await prisma.riddenRoadsCache.upsert({
        where: { athleteId: key },
        create: { athleteId: key, roads: deduped as any, version: RIDDEN_VERSION, refreshedAt: new Date() },
        update: { roads: deduped as any, version: RIDDEN_VERSION, refreshedAt: new Date() },
    });
    console.log(`${ts()} RiddenRoads worker: cached ${deduped.length} segments for ${key}`);
    await prisma.riddenRoadsJob.delete({ where: { key } });
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
