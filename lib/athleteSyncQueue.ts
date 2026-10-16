import { prisma } from './prisma';
import { encryptToken } from './tokenCrypto';
import type { ActivityMode, Creds } from './riddenRoadsRefresh';

export type SyncAspect = 'create' | 'update' | 'delete' | 'deauthorize' | 'resync' | 'recompute';

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
        await prisma.stravaSyncEvent.create({
            data: {
                athleteId,
                aspect,
                activityId: opts.activityId ?? null,
                mode: opts.mode ?? null,
                credsEncrypted: opts.creds?.refreshToken ? encryptToken(JSON.stringify(opts.creds)) : null,
            },
        });
    } catch (e: any) {
        console.warn(`${ts()} AthleteSync: failed to enqueue ${aspect} for ${athleteId}: ${e.message}`);
    }
}

export async function hasPendingSync(athleteId: string): Promise<boolean> {
    return (await prisma.stravaSyncEvent.count({ where: { athleteId } })) > 0;
}
