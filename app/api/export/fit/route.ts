import { NextRequest, NextResponse } from 'next/server';
import { buildFitCourse } from '@/lib/fit';

export async function POST(req: NextRequest) {
    try {
        const { route, name } = await req.json();

        if (!route || !Array.isArray(route) || route.length < 2) {
            return NextResponse.json({ error: 'Missing or invalid route data' }, { status: 400 });
        }

        const fitBytes = buildFitCourse(route, name ?? 'StreetSweep Course');

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
