import { withApiMetrics, incrementMetric } from '@/lib/metrics';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { parseBody } from '@/lib/validation';
import { enqueueAthleteSync } from '@/lib/athleteSyncQueue';
import { safeEqual } from '@/lib/secureCompare';

// Strava push subscription callback (#118). Strava gives up on an event after
// a few retries if this doesn't answer 200 within 2 seconds, so it only queues
// the event; the worker machine does the actual work (lib/athleteSyncWorker.ts).
// Register the subscription with scripts/strava-webhook.js, with
// ?key=<STRAVA_WEBHOOK_CALLBACK_SECRET> on the callback URL.

// Strava doesn't sign events, and the subscription id is a guessable integer,
// so the callback URL carries a secret only Strava knows (#199).
function hasCallbackSecret(request: Request): boolean {
    const secret = process.env.STRAVA_WEBHOOK_CALLBACK_SECRET;
    return !!secret && safeEqual(new URL(request.url).searchParams.get('key') ?? '', secret);
}

// Subscription validation handshake, sent once when the subscription is created.
async function handleGET(request: Request) {
    const params = new URL(request.url).searchParams;
    const verifyToken = process.env.STRAVA_WEBHOOK_VERIFY_TOKEN;
    if (!hasCallbackSecret(request) || !verifyToken || params.get('hub.mode') !== 'subscribe' || !safeEqual(params.get('hub.verify_token') ?? '', verifyToken)) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    return NextResponse.json({ 'hub.challenge': params.get('hub.challenge') });
}

const Event = z.object({
    object_type: z.enum(['activity', 'athlete']),
    object_id: z.number().int(),
    aspect_type: z.enum(['create', 'update', 'delete']),
    owner_id: z.number().int(),
    subscription_id: z.number().int(),
    updates: z.record(z.string(), z.unknown()).optional(),
});

async function handlePOST(request: Request) {
    if (!hasCallbackSecret(request)) {
        incrementMetric('webhook.rejected');
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    const parsed = await parseBody(request, Event);
    if ('error' in parsed) return parsed.error;
    const event = parsed.data;

    // Strava doesn't sign events, so at least reject ones for another subscription,
    // and all of them when ours isn't configured (#189).
    const subscriptionId = process.env.STRAVA_WEBHOOK_SUBSCRIPTION_ID;
    if (!subscriptionId || String(event.subscription_id) !== subscriptionId) {
        incrementMetric('webhook.rejected');
        return NextResponse.json({ error: 'Unknown subscription' }, { status: 403 });
    }

    const athleteId = String(event.owner_id);
    // Ignore athletes this app holds nothing for, so a forged event can't grow the queue.
    const known = await prisma.stravaActivityCache.findUnique({ where: { athleteId }, select: { athleteId: true } })
        ?? await prisma.account.findFirst({ where: { provider: 'strava', providerAccountId: athleteId }, select: { id: true } });
    if (!known) {
        incrementMetric('webhook.ignored');
        return NextResponse.json({ ok: true });
    }

    if (event.object_type === 'athlete') {
        if (event.updates?.authorized === 'false') await enqueueAthleteSync(athleteId, 'deauthorize');
    } else {
        await enqueueAthleteSync(athleteId, event.aspect_type, { activityId: String(event.object_id) });
    }
    return NextResponse.json({ ok: true });
}

export const GET = withApiMetrics('GET', '/api/strava/webhook', handleGET);
export const POST = withApiMetrics('POST', '/api/strava/webhook', handlePOST);
