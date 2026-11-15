import { withApiMetrics } from '@/lib/metrics';
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { z } from 'zod';
import { authOptions } from '@/lib/auth';
import { parseBody, Polyline } from '@/lib/validation';

type Roads = [number, number][][];

const RoadsBody = z.object({ roads: z.array(Polyline).max(1_000) });

async function sessionUserId(): Promise<string | undefined> {
    const session = await getServerSession(authOptions);
    return (session?.user as { id?: string } | undefined)?.id;
}

// GET/PUT for a list of roads the signed-in user marked on the map: avoided (#45)
// or preferred (#46). Each list is one row per user.
export function markedRoadsRoute(path: string, store: {
    find: (userId: string) => Promise<{ roads: unknown } | null>;
    save: (userId: string, roads: Roads) => Promise<unknown>;
}) {
    async function handleGET() {
        const userId = await sessionUserId();
        if (!userId) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
        const row = await store.find(userId);
        return NextResponse.json({ roads: row?.roads ?? [] });
    }

    async function handlePUT(req: Request) {
        const userId = await sessionUserId();
        if (!userId) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
        const parsed = await parseBody(req, RoadsBody);
        if ('error' in parsed) return parsed.error;
        const { roads } = parsed.data;
        await store.save(userId, roads as Roads);
        return NextResponse.json({ roads });
    }

    return { GET: withApiMetrics('GET', path, handleGET), PUT: withApiMetrics('PUT', path, handlePUT) };
}
