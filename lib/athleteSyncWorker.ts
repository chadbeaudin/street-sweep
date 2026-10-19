// Processes the per-athlete queue fed by the Strava webhook (#118), run only
// by the `worker` Fly machine's tick loop (app/api/internal/ridden-roads-tick).
// Each tick handles one athlete: apply that athlete's queued activity changes
// to the cached activity list, recompute stats, and re-match only the
// ridden-roads tiles the changed rides cross.
import polyline from '@mapbox/polyline';
import type { StravaSyncEvent } from './generated/prisma/client';
import { prisma } from './prisma';
import { decryptToken } from './tokenCrypto';
import { fetchStravaActivity, getStravaAccessToken, resolveAthleteId, syncActivities, StravaActivity } from './strava';
import { isModeActivity } from './stats';
import { recomputeStats, statsCacheKey } from './statsCompute';
import { enqueueAthleteSync } from './athleteSyncQueue';
import { creditMatchingActivities } from './routeCredit';
import { decryptJobCreds, refreshRiddenRoadsInBackground, riddenRoadsCacheKey, tilesForBbox, ActivityMode, Creds } from './riddenRoadsRefresh';

const ts = () => `[${new Date().toTimeString().slice(0, 8)}]`;

// Waits for an athlete's events to go quiet so a burst (a bulk upload, an
// upload followed by a title edit) costs one recompute, not one per event.
export const DEBOUNCE_MS = 20 * 1000;
const MAX_ATTEMPTS = 5;
// A cold stats compute can outlast the tick loop's 5-minute request timeout, after
// which the loop ticks again while the first run is still going. Claimed events
// are skipped until they're this stale (a crashed run), so runs never overlap.
const CLAIM_TTL_MS = 30 * 60 * 1000;
const RETRY_BACKOFF_MS = 5 * 60 * 1000;
// Catch-up for webhook deliveries Strava gave up on: new rides daily, and a
// full re-pull weekly for edits/deletes, which a newer-than pull never sees.
const RESYNC_INTERVAL_MS = 24 * 60 * 60 * 1000;
const FULL_RESYNC_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;
const SWEEP_INTERVAL_MS = 60 * 1000;
const MODES: ActivityMode[] = ['cycling', 'running'];

// Distinguishes "use the server's own STRAVA_* env credentials" ({ creds: undefined })
// from "no way to act for this athlete" (null).
async function credsFor(athleteId: string, events: StravaSyncEvent[]): Promise<{ creds?: Creds } | null> {
    const withCreds = [...events].reverse().find(e => e.credsEncrypted);
    if (withCreds?.credsEncrypted) return { creds: decryptJobCreds(withCreds.credsEncrypted) };
    const account = await prisma.account.findFirst({ where: { provider: 'strava', providerAccountId: athleteId, refresh_token: { not: null } } });
    if (account?.refresh_token) return { creds: { refreshToken: decryptToken(account.refresh_token) } };
    if (process.env.STRAVA_REFRESH_TOKEN && await resolveAthleteId().catch(() => null) === athleteId) return {};
    return null;
}

// Strava requires dropping an athlete's data once they revoke this app's access.
async function purgeAthlete(athleteId: string): Promise<void> {
    const keys = MODES.map(m => riddenRoadsCacheKey(athleteId, m));
    await prisma.$transaction([
        prisma.statsCache.deleteMany({ where: { athleteId: { in: MODES.map(m => statsCacheKey(athleteId, m)) } } }),
        prisma.stravaActivityCache.deleteMany({ where: { athleteId } }),
        prisma.stravaActivityDetail.deleteMany({ where: { athleteId } }),
        prisma.stravaActivityStream.deleteMany({ where: { athleteId } }),
        prisma.riddenRoadsTile.deleteMany({ where: { athleteKey: { in: keys } } }),
        prisma.riddenRoadsJob.deleteMany({ where: { athleteId } }),
        prisma.ftpReadingCache.deleteMany({ where: { athleteId } }),
        // The tokens are dead; clearing them keeps the catch-up sweep from retrying them.
        // Signing in again re-links them (lib/auth.ts events.signIn).
        prisma.account.updateMany({ where: { provider: 'strava', providerAccountId: athleteId }, data: { refresh_token: null, access_token: null } }),
    ]);
    console.log(`${ts()} AthleteSync: purged data for deauthorized athlete ${athleteId}`);
}

function modesOf(activity: StravaActivity): ActivityMode[] {
    return MODES.filter(m => isModeActivity(activity.sport_type || activity.type, m));
}

function tilesOf(activity: StravaActivity): string[] {
    const tiles = new Set<string>();
    for (const [lat, lon] of polyline.decode(activity.map.summary_polyline)) {
        for (const t of tilesForBbox({ south: lat, north: lat, west: lon, east: lon })) tiles.add(t);
    }
    return [...tiles];
}

// Latest event per activity wins (an update followed by a delete is a delete).
// Returns whether the cached list changed, recording the ridden-roads tiles
// every changed ride (before and after) crosses.
async function applyActivityEvents(athleteId: string, accessToken: string, latest: Map<string, string>, touched: Map<ActivityMode, Set<string>>): Promise<boolean> {
    const row = await prisma.stravaActivityCache.findUnique({ where: { athleteId } });
    if (!row) return false; // nothing cached yet: the first full sync picks these up
    const byId = new Map((row.activities as unknown as StravaActivity[]).map(a => [String(a.id), a]));
    const touch = (a: StravaActivity) => {
        for (const mode of modesOf(a)) {
            const set = touched.get(mode) ?? new Set<string>();
            for (const t of tilesOf(a)) set.add(t);
            touched.set(mode, set);
        }
    };

    for (const [activityId, aspect] of latest) {
        const before = byId.get(activityId);
        const after = aspect === 'delete' ? null : await fetchStravaActivity(accessToken, activityId);
        if (before) touch(before);
        if (after) {
            touch(after.activity);
            byId.set(activityId, after.activity);
            if (after.fullPolyline) {
                await prisma.stravaActivityDetail.upsert({
                    where: { activityId },
                    create: { activityId, athleteId, polyline: after.fullPolyline },
                    update: { athleteId, polyline: after.fullPolyline },
                });
            }
        } else {
            byId.delete(activityId);
            await prisma.stravaActivityDetail.deleteMany({ where: { activityId } });
            await prisma.stravaActivityStream.deleteMany({ where: { activityId } });
        }
    }

    const activities = [...byId.values()].sort((a, b) => b.start_date.localeCompare(a.start_date));
    // A delivered event proves the webhook is live, so it also counts as a sync.
    await prisma.stravaActivityCache.update({ where: { athleteId }, data: { activities: activities as any, syncedAt: new Date() } });
    return true;
}

async function resync(athleteId: string, accessToken: string): Promise<boolean> {
    const row = await prisma.stravaActivityCache.findUnique({ where: { athleteId } });
    const full = !row?.fullSyncedAt || Date.now() - row.fullSyncedAt.getTime() > FULL_RESYNC_INTERVAL_MS;
    const { changed } = await syncActivities(athleteId, accessToken, row ? row.activities as unknown as StravaActivity[] : null, { full });
    return changed;
}

// Same check the app runs when the rider opens it (/api/strava/activities), so a
// ride that followed an exported route is credited without waiting for that.
// Never fails the batch: a credit retry isn't worth redoing the stats recompute.
async function creditNewRides(athleteId: string): Promise<void> {
    const user = await prisma.user.findUnique({ where: { athleteId }, select: { id: true } });
    if (!user) return;
    await creditMatchingActivities(user.id)
        .catch(e => console.warn(`${ts()} AthleteSync: route credit skipped for athlete ${athleteId}: ${e.message}`));
}

async function processAthlete(athleteId: string, events: StravaSyncEvent[]): Promise<void> {
    if (events.some(e => e.aspect === 'deauthorize')) return purgeAthlete(athleteId);

    const resolved = await credsFor(athleteId, events);
    if (!resolved) {
        console.warn(`${ts()} AthleteSync: no credentials for athlete ${athleteId}; dropping ${events.length} event(s)`);
        return;
    }
    const { creds } = resolved;
    const accessToken = await getStravaAccessToken(creds);

    const latest = new Map<string, string>();
    for (const e of events) if (e.activityId && ['create', 'update', 'delete'].includes(e.aspect)) latest.set(e.activityId, e.aspect);
    const touched = new Map<ActivityMode, Set<string>>();
    let changed = latest.size > 0 && await applyActivityEvents(athleteId, accessToken, latest, touched);
    if (events.some(e => e.aspect === 'resync')) changed = (await resync(athleteId, accessToken)) || changed;

    // Before the stats recompute, which can take a minute or more.
    if (changed) await creditNewRides(athleteId);

    const modes = new Set<ActivityMode>();
    for (const e of events) {
        if (e.aspect !== 'recompute') continue;
        if (e.mode) modes.add(e.mode as ActivityMode);
        else MODES.forEach(m => modes.add(m));
    }
    if (changed) {
        // Every mode this athlete has stats for -- cycling always, since it's the default view.
        const cachedModes = await prisma.statsCache.findMany({ where: { athleteId: { in: MODES.map(m => statsCacheKey(athleteId, m)) } }, select: { athleteId: true } });
        modes.add('cycling');
        if (cachedModes.some(r => r.athleteId === statsCacheKey(athleteId, 'running'))) modes.add('running');
    }
    for (const mode of modes) await recomputeStats(athleteId, creds, mode);

    // Only tiles already cached for this athlete: anything else is matched the
    // first time someone looks at it anyway.
    for (const [mode, tiles] of touched) {
        const key = riddenRoadsCacheKey(athleteId, mode);
        const existing = await prisma.riddenRoadsTile.findMany({ where: { athleteKey: key, tile: { in: [...tiles] } }, select: { tile: true } });
        if (existing.length > 0) await refreshRiddenRoadsInBackground(athleteId, creds ?? {}, mode, existing.map(r => r.tile));
    }
}

let lastSweep = 0;

// Queues a catch-up resync for one signed-in athlete whose activity list is due.
export async function enqueueDueResync(now = Date.now()): Promise<string | null> {
    if (now - lastSweep < SWEEP_INTERVAL_MS) return null;
    lastSweep = now;
    const accounts = await prisma.account.findMany({ where: { provider: 'strava', refresh_token: { not: null } }, select: { providerAccountId: true } });
    const athleteIds = accounts.map(a => a.providerAccountId);
    if (athleteIds.length === 0) return null;
    const [caches, pending] = await Promise.all([
        prisma.stravaActivityCache.findMany({ where: { athleteId: { in: athleteIds } }, select: { athleteId: true, syncedAt: true, fullSyncedAt: true } }),
        prisma.stravaSyncEvent.findMany({ where: { athleteId: { in: athleteIds } }, select: { athleteId: true }, distinct: ['athleteId'] }),
    ]);
    const busy = new Set(pending.map(p => p.athleteId));
    // An athlete with no cached list has never opened the app's map; their first visit does the full pull.
    const due = caches.find(c => !busy.has(c.athleteId) && (
        now - c.syncedAt.getTime() > RESYNC_INTERVAL_MS ||
        !c.fullSyncedAt || now - c.fullSyncedAt.getTime() > FULL_RESYNC_INTERVAL_MS
    ));
    if (!due) return null;
    await enqueueAthleteSync(due.athleteId, 'resync');
    return due.athleteId;
}

// Claims and processes at most one athlete's queued events, then returns --
// one bounded unit of work per tick, like tickRiddenRoadsWorker.
export async function tickAthleteSyncWorker(now = Date.now()): Promise<{ processed: boolean; athleteId?: string }> {
    const claimable = { availableAt: { lte: new Date(now) }, OR: [{ claimedAt: null }, { claimedAt: { lt: new Date(now - CLAIM_TTL_MS) } }] };
    const [ready] = await prisma.stravaSyncEvent.groupBy({
        by: ['athleteId'],
        where: claimable,
        _max: { createdAt: true },
        _min: { id: true },
        having: { createdAt: { _max: { lte: new Date(now - DEBOUNCE_MS) } } },
        orderBy: { _min: { id: 'asc' } },
        take: 1,
    });
    if (!ready) {
        await enqueueDueResync(now);
        return { processed: false };
    }

    const { athleteId } = ready;
    const events = await prisma.stravaSyncEvent.findMany({ where: { athleteId, ...claimable }, orderBy: { id: 'asc' } });
    const ids = events.map(e => e.id);
    // Counted when claimed, not on failure: a run that gets OOM-killed never reaches
    // the catch below, and would otherwise be retried forever (#123).
    const attempts = Math.max(...events.map(ev => ev.attempts)) + 1;
    if (attempts > MAX_ATTEMPTS) {
        console.warn(`${ts()} AthleteSync: giving up on athlete ${athleteId}: ${MAX_ATTEMPTS} attempts never finished`);
        await prisma.stravaSyncEvent.deleteMany({ where: { id: { in: ids } } });
        return { processed: true, athleteId };
    }
    const claimed = await prisma.stravaSyncEvent.updateMany({ where: { id: { in: ids }, ...claimable }, data: { claimedAt: new Date(now), attempts } });
    if (claimed.count !== ids.length) return { processed: false }; // another tick got there first
    try {
        await processAthlete(athleteId, events);
        await prisma.stravaSyncEvent.deleteMany({ where: { id: { in: ids } } });
    } catch (e: any) {
        if (attempts >= MAX_ATTEMPTS) {
            console.warn(`${ts()} AthleteSync: giving up on athlete ${athleteId} after ${attempts} attempts: ${e.message}`);
            await prisma.stravaSyncEvent.deleteMany({ where: { id: { in: ids } } });
        } else {
            console.warn(`${ts()} AthleteSync: athlete ${athleteId} failed (attempt ${attempts}), retrying later: ${e.message}`);
            await prisma.stravaSyncEvent.updateMany({ where: { id: { in: ids } }, data: { claimedAt: null, availableAt: new Date(now + RETRY_BACKOFF_MS * attempts) } });
        }
    }
    return { processed: true, athleteId };
}
