import { prisma } from './prisma';
import { encryptToken } from './tokenCrypto';
import { incrementMetric } from './metrics';
import type { ActivityMode, Creds } from './riddenRoadsRefresh';

export type SyncAspect = 'create' | 'update' | 'delete' | 'deauthorize' | 'resync' | 'recompute';

// A forged or runaway event stream can't grow one athlete's queue past this (#199).
// Deauthorize is exempt: Strava requires acting on a revocation.
export const MAX_PENDING_PER_ATHLETE = 200;

const ts = () => `[${new Date().toTimeString().slice(0, 8)}]`;

// Fast and side-effect-light: called inline from API routes (including the
// Strava webhook, which must answer within 2s). All the real work happens on
// the worker machine (lib/athleteSyncWorker.ts).
export async function enqueueAthleteSync(
    athleteId: string,
    aspect: SyncAspect,
    opts: { activityId?: string; mode?: ActivityMode; creds?: Creds } = {},
): Promise<void> {
    try {
        const activityId = opts.activityId ?? null;
        const mode = opts.mode ?? null;
        const pending = { athleteId, claimedAt: null };
        if (await prisma.stravaSyncEvent.findFirst({ where: { ...pending, aspect, activityId, mode }, select: { id: true } })) {
            incrementMetric('worker.enqueue_duplicate');
            return;
        }
        if (aspect !== 'deauthorize' && await prisma.stravaSyncEvent.count({ where: pending }) >= MAX_PENDING_PER_ATHLETE) {
            console.warn(`${ts()} AthleteSync: queue full for ${athleteId}; dropping ${aspect}`);
            incrementMetric('worker.enqueue_capped');
            return;
        }
        await prisma.stravaSyncEvent.create({
            data: {
                athleteId,
                aspect,
                activityId,
                mode,
                credsEncrypted: opts.creds?.refreshToken ? encryptToken(JSON.stringify(opts.creds)) : null,
            },
        });
    } catch (e: any) {
        console.warn(`${ts()} AthleteSync: failed to enqueue ${aspect} for ${athleteId}: ${e.message}`);
        incrementMetric('worker.enqueue_failed');
    }
}

export async function hasPendingSync(athleteId: string): Promise<boolean> {
    return (await prisma.stravaSyncEvent.count({ where: { athleteId } })) > 0;
}
