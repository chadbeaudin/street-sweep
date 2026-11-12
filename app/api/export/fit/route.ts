import { withApiMetrics } from '@/lib/metrics';
import { withRateLimit } from '@/lib/rateLimit';
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { buildFitCourse } from '@/lib/fit';
import { Route, parseBody } from '@/lib/validation';

const Body = z.object({ route: Route.min(2), name: z.string().max(200).optional().nullable() });

async function handlePOST(req: NextRequest) {
    try {
        const parsed = await parseBody(req, Body);
        if ('error' in parsed) return parsed.error;
        const { route, name } = parsed.data;

        const fitBytes = buildFitCourse(route as [number, number, number?, number?][], name ?? 'StreetSweep Course');

        const fitBuffer = Buffer.from(fitBytes);

        return new NextResponse(fitBuffer, {
            status: 200,
            headers: {
                'Content-Type': 'application/octet-stream',
                'Content-Disposition': `attachment; filename="${(name ?? 'streetsweep-course').replace(/[^a-z0-9]/gi, '_')}.fit"`,
                'Content-Length': fitBuffer.byteLength.toString(),
            },
        });
    } catch (error: any) {
        console.error('FIT export error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

export const POST = withApiMetrics('POST', '/api/export/fit', withRateLimit('exportFit', handlePOST));
