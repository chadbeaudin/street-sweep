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

// Rides only pass through a small fraction of tiles, so those are the only
// ones that cost an Overpass fetch; fetch several at once since Overpass is
// self-hosted (its own per-client rate limit is configured on the server).
const FETCH_CONCURRENCY = Number(process.env.RIDDEN_FETCH_CONCURRENCY ?? 4);

async function forEachConcurrent<T>(items: T[], limit: number, fn: (item: T) => Promise<void>) {
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
        while (next < items.length) await fn(items[next++]);
    }));
}

// Removes finished tiles in SQL rather than writing back a snapshot, so
// concurrent completions and the API route extending the job with newly
// requested tiles never overwrite each other.
async function markTilesDone(key: string, tiles: string[]) {
    await prisma.$executeRaw`
        UPDATE ridden_roads_jobs
        SET tiles = COALESCE((SELECT jsonb_agg(t) FROM jsonb_array_elements(tiles) t WHERE NOT (t #>> '{}') = ANY(${tiles}::text[])), '[]'::jsonb),
            "updatedAt" = now()
        WHERE key = ${key}`;
}

async function processJob(job: Job) {
    const { key, athleteId, mode } = job;
    const pending: string[] = Array.isArray(job.tiles) ? (job.tiles as any) : [];
    console.log(`${ts()} RiddenRoads worker: starting ${key} (${pending.length} tiles pending)`);
    if (pending.length > 0) {
        const creds = decryptJobCreds(job.credsEncrypted);

        // Fetched once per tick, not per tile -- this is proportional to one
        // rider's own ride count, which is bounded regardless of how many tiles
        // are being (re)computed this tick.
        const { riddenRoads } = await fetchCyclingRiddenRoads(creds, mode as ActivityMode);

        const empty: string[] = [];
        const withRides: { tile: string; localRidden: [number, number][][] }[] = [];
        for (const tile of pending) {
            const localRidden = filterRiddenRoadsToBbox(riddenRoads, tileBbox(tile), TILE_MATCH_PADDING_M) ?? [];
            if (localRidden.length > 0) withRides.push({ tile, localRidden });
            else empty.push(tile);
        }

        // Nothing this rider has ever done passes through these tiles -- an
        // empty (but present) cache row still avoids re-checking them on every
        // future viewport visit. Written in one batch since they're most tiles.
        if (empty.length > 0) {
            const refreshedAt = new Date();
            await prisma.$transaction([
                prisma.riddenRoadsTile.deleteMany({ where: { athleteKey: key, tile: { in: empty } } }),
                prisma.riddenRoadsTile.createMany({ data: empty.map(tile => ({ athleteKey: key, tile, roads: [], version: RIDDEN_VERSION, refreshedAt })) }),
            ]);
            await markTilesDone(key, empty);
        }

        let done = empty.length;
        await forEachConcurrent(withRides, FETCH_CONCURRENCY, async ({ tile, localRidden }) => {
            try {
                const osm = await fetchOSMData(tileBbox(tile));
                const deduped = dedupeRiddenRoads(localRidden, roadsFromOSM(osm));
                await prisma.riddenRoadsTile.upsert({
                    where: { athleteKey_tile: { athleteKey: key, tile } },
                    create: { athleteKey: key, tile, roads: deduped as any, version: RIDDEN_VERSION, refreshedAt: new Date() },
                    update: { roads: deduped as any, version: RIDDEN_VERSION, refreshedAt: new Date() },
                });
                await markTilesDone(key, [tile]);
                done++;
            } catch (e: any) {
                console.warn(`${ts()} RiddenRoads worker: tile ${tile} failed, will retry next tick: ${e.message}`);
            }
        });
        console.log(`${ts()} RiddenRoads worker: ${done}/${pending.length} tiles done for ${key}`);
    }

    // Anything still pending -- failed tiles, or tiles the API route added
    // while this tick ran -- goes back to the queue for the next tick.
    await prisma.$executeRaw`DELETE FROM ridden_roads_jobs WHERE key = ${key} AND jsonb_array_length(tiles) = 0`;
    await prisma.$executeRaw`UPDATE ridden_roads_jobs SET status = 'queued' WHERE key = ${key} AND status = 'running'`;
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
