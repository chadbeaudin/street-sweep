import { withApiMetrics } from '@/lib/metrics';
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { recordExportedRoute } from '@/lib/routeCredit';
import { z } from 'zod';
import { Route, parseBody } from '@/lib/validation';

// Bounded because the route is stored (#193).
const Body = z.object({ route: Route.min(2) });

async function handlePOST(req: Request) {
    const session = await getServerSession(authOptions);
    const userId = (session?.user as { id?: string } | undefined)?.id;
    if (!userId) return NextResponse.json({ recorded: false });

    const parsed = await parseBody(req, Body);
    if ('error' in parsed) return parsed.error;
    const { route } = parsed.data;

    await recordExportedRoute(userId, route.map(([lon, lat]) => [lat, lon]));
    return NextResponse.json({ recorded: true });
}

export const POST = withApiMetrics('POST', '/api/exported-routes', handlePOST);
