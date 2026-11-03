import { withApiMetrics } from '@/lib/metrics';
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { z } from 'zod';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { parseBody, Polyline } from '@/lib/validation';

const AvoidedRoadsBody = z.object({ roads: z.array(Polyline).max(1_000) });

async function sessionUserId(): Promise<string | undefined> {
    const session = await getServerSession(authOptions);
    return (session?.user as { id?: string } | undefined)?.id;
}

async function handleGET() {
    const userId = await sessionUserId();
    if (!userId) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

    const row = await prisma.avoidedRoads.findUnique({ where: { userId } });
    return NextResponse.json({ roads: row?.roads ?? [] });
}

async function handlePUT(req: Request) {
    const userId = await sessionUserId();
    if (!userId) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

    const parsed = await parseBody(req, AvoidedRoadsBody);
    if ('error' in parsed) return parsed.error;

    const { roads } = parsed.data;
    await prisma.avoidedRoads.upsert({ where: { userId }, create: { userId, roads }, update: { roads } });
    return NextResponse.json({ roads });
}

export const GET = withApiMetrics('GET', '/api/avoided-roads', handleGET);
export const PUT = withApiMetrics('PUT', '/api/avoided-roads', handlePUT);
