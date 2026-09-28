import { NextResponse } from 'next/server';
import { tickRiddenRoadsWorker } from '@/lib/riddenRoadsWorkerJob';

// Only ever called by the `worker` Fly machine's own self-ticking loop over
// loopback (see fly.toml [processes].worker) -- this same compiled code also
// runs on the public-facing `app` machine (Fly process groups share one
// image), so this route must reject any caller that doesn't know the shared
// secret. Never publicly documented/linked; a guessed/leaked secret is the
// only way to trigger a recompute job early, which is a nuisance, not a data
// exposure (it only processes jobs already enqueued via the normal
// authenticated flow).
export async function POST(request: Request) {
    const secret = process.env.INTERNAL_WORKER_SECRET;
    if (!secret || request.headers.get('x-internal-secret') !== secret) {
        return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    try {
        const result = await tickRiddenRoadsWorker();
        return NextResponse.json(result);
    } catch (e: any) {
        console.error('ridden-roads-tick error:', e);
        return NextResponse.json({ error: e.message || 'Internal Server Error' }, { status: 500 });
    }
}
