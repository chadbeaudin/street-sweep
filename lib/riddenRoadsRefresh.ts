import { prisma } from './prisma';
import { encryptToken, decryptToken } from './tokenCrypto';

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
// Guard against a runaway precompute. Self-hosted Overpass (OVERPASS_URL) has
// no external rate limit, so this is generous — it exists to catch pathological
// cases (corrupt data, a global-spanning footprint), not typical riders.
export const MAX_TILES = Number(process.env.RIDDEN_MAX_TILES ?? 5000);
export const TILE = 0.02; // ~2.2km tiles to gather OSM roads over the riding footprint

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

// Enqueues a recompute job for the worker process (worker.ts) to pick up --
// this must stay fast and side-effect-light, since it's called inline from
// API route handlers (app/api/ridden-roads, app/api/strava/activities) and
// must never itself do the actual tile-fetch/dedupe work. That work used to
// run fire-and-forget in this same process and could OOM-crash or, worse,
// block the Node event loop for the whole app for 10+ minutes (a real prod
// incident) -- moving it to an isolated worker means a crash there can never
// take down web traffic, and DB-backed job state (rather than an in-memory
// Set) means "is a refresh already in flight" survives a process restart.
export async function refreshRiddenRoadsInBackground(athleteId: string, creds: Creds, mode: ActivityMode): Promise<void> {
    const key = riddenRoadsCacheKey(athleteId, mode);
    try {
        const existing = await prisma.riddenRoadsJob.findUnique({ where: { key } });
        if (existing) {
            const stale = existing.status === 'running' && Date.now() - existing.updatedAt.getTime() > STALE_RUNNING_MS;
            if (existing.status === 'queued' || (existing.status === 'running' && !stale)) {
                return; // already in flight, don't double-enqueue
            }
        }
        const credsEncrypted = encryptToken(JSON.stringify(creds));
        await prisma.riddenRoadsJob.upsert({
            where: { key },
            create: { key, athleteId, mode, status: 'queued', credsEncrypted },
            update: { status: 'queued', credsEncrypted, tilesDone: 0, tilesTotal: 0, partialRoads: undefined, error: null },
        });
        console.log(`${ts()} RiddenRoads: enqueued job for ${key}`);
    } catch (e: any) {
        console.warn(`${ts()} RiddenRoads: failed to enqueue job for ${key}: ${e.message}`);
    }
}

// Fast status check for API routes reporting `refreshing`/`computing` to the
// client -- a single indexed primary-key lookup, safe to call on every
// request.
export async function isRiddenRoadsJobActive(key: string): Promise<boolean> {
    const job = await prisma.riddenRoadsJob.findUnique({ where: { key } });
    if (!job) return false;
    if (job.status === 'queued') return true;
    if (job.status === 'running') return Date.now() - job.updatedAt.getTime() <= STALE_RUNNING_MS;
    return false;
}

export function decryptJobCreds(credsEncrypted: string): Creds {
    return JSON.parse(decryptToken(credsEncrypted));
}
