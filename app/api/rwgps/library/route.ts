import { withApiMetrics } from '@/lib/metrics';
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { z } from 'zod';
import { authOptions } from '@/lib/auth';
import { listRoutes, listCollections, buildLibraryTree, RwgpsAccessToken } from '@/lib/rwgps';
import { parseBody } from '@/lib/validation';

const Body = z.object({ accessToken: RwgpsAccessToken });

async function handlePOST(req: Request) {
    try {
        // Without this, anyone could drive the RideWithGPS API with the server's API key (#190).
        const session = await getServerSession(authOptions);
        if (!(session?.user as { id?: string } | undefined)?.id) {
            return NextResponse.json({ error: 'Sign in to use RideWithGPS' }, { status: 401 });
        }

        const parsed = await parseBody(req, Body);
        if ('error' in parsed) return parsed.error;
        const { accessToken } = parsed.data;

        const [routes, collections] = await Promise.all([
            listRoutes(accessToken),
            listCollections(accessToken),
        ]);

        return NextResponse.json(buildLibraryTree(routes, collections));
    } catch (error: any) {
        console.error('RideWithGPS library fetch error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}

export const POST = withApiMetrics('POST', '/api/rwgps/library', handlePOST);
