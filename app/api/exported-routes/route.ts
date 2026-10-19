import { withApiMetrics } from '@/lib/metrics';
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { recordExportedRoute } from '@/lib/routeCredit';

async function handlePOST(req: Request) {
    const session = await getServerSession(authOptions);
    const userId = (session?.user as { id?: string } | undefined)?.id;
    if (!userId) return NextResponse.json({ recorded: false });

    const { route } = await req.json() as { route?: [number, number, ...unknown[]][] };
    if (!Array.isArray(route) || route.length < 2) return NextResponse.json({ error: 'route required' }, { status: 400 });

    await recordExportedRoute(userId, route.map(([lon, lat]) => [lat, lon]));
    return NextResponse.json({ recorded: true });
}

export const POST = withApiMetrics('POST', '/api/exported-routes', handlePOST);
