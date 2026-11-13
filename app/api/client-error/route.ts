import { withApiMetrics, incrementMetric } from '@/lib/metrics';
import { withRateLimit } from '@/lib/rateLimit';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { CLIENT_ERROR_KINDS } from '@/lib/clientErrors';
import { parseBody } from '@/lib/validation';

// A fixed list of kinds, so a caller can't create arbitrary metric names.
const Body = z.object({ kind: z.enum(CLIENT_ERROR_KINDS) });

async function handlePOST(req: Request) {
    const parsed = await parseBody(req, Body);
    if ('error' in parsed) return parsed.error;
    incrementMetric(`client_error.${parsed.data.kind}`);
    return NextResponse.json({ ok: true });
}

export const POST = withApiMetrics('POST', '/api/client-error', withRateLimit('clientError', handlePOST));
