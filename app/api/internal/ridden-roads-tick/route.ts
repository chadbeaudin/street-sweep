import { NextResponse } from 'next/server';
import { errorResponse } from '@/lib/apiErrors';
import { tickRiddenRoadsWorker } from '@/lib/riddenRoadsWorkerJob';
import { tickAthleteSyncWorker } from '@/lib/athleteSyncWorker';
import { safeEqual } from '@/lib/secureCompare';

// Only ever called by the worker container's own self-ticking loop over
// loopback (see scripts/worker-tick-loop.js) -- this same compiled code also
// runs on the public-facing Fly `app` machine (both use one image), so this route must reject any caller that doesn't know the shared
// secret. Never publicly documented/linked; a guessed/leaked secret is the
// only way to trigger a recompute job early, which is a nuisance, not a data
// exposure (it only processes jobs already enqueued via the normal
// authenticated flow).
export async function POST(request: Request) {
    const secret = process.env.INTERNAL_WORKER_SECRET;
    if (!secret || !safeEqual(request.headers.get('x-internal-secret') ?? '', secret)) {
        return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    try {
        // Also drives the Strava webhook queue (#118), so one worker loop covers both.
        const riddenRoads = await tickRiddenRoadsWorker();
        const athleteSync = await tickAthleteSyncWorker();
        return NextResponse.json({ ...riddenRoads, athleteSync });
    } catch (e: any) {
        return errorResponse(e, 'ridden-roads-tick error:', 'Worker tick failed.');
    }
}
