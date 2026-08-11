import { NextResponse } from 'next/server';
import { fetchFtpReadings, resolveAthleteId } from '@/lib/strava';
import { prisma } from '@/lib/prisma';

const ts = () => `[${new Date().toTimeString().slice(0, 8)}]`;
const FRESH_TTL_MS = 24 * 60 * 60 * 1000;

interface Creds { clientId?: string; clientSecret?: string; refreshToken?: string }

const REFRESHING = new Set<string>();

async function refreshInBackground(athleteId: string, creds: Creds) {
    if (REFRESHING.has(athleteId)) return;
    REFRESHING.add(athleteId);
    try {
        console.log(`${ts()} Ftp: refresh starting for ${athleteId}`);
        const readings = await fetchFtpReadings(creds);
        await prisma.ftpReadingCache.upsert({
            where: { athleteId },
            create: { athleteId, readings: readings as any, refreshedAt: new Date() },
            update: { readings: readings as any, refreshedAt: new Date() },
        });
        console.log(`${ts()} Ftp: cached ${readings.length} readings for ${athleteId}`);
    } catch (e: any) {
        console.warn(`${ts()} Ftp refresh failed for ${athleteId}: ${e.message}`);
    } finally {
        REFRESHING.delete(athleteId);
    }
}

export async function POST(request: Request) {
    try {
        const { stravaCredentials } = await request.json() as { stravaCredentials?: Creds };
        if (!stravaCredentials?.refreshToken) {
            return NextResponse.json({ error: 'stravaCredentials.refreshToken required' }, { status: 400 });
        }
        const athleteId = await resolveAthleteId(stravaCredentials);
        const cached = await prisma.ftpReadingCache.findUnique({ where: { athleteId } });

        if (cached) {
            const stale = Date.now() - cached.refreshedAt.getTime() > FRESH_TTL_MS;
            if (stale) refreshInBackground(athleteId, stravaCredentials);
            return NextResponse.json({
                readings: cached.readings,
                refreshedAt: cached.refreshedAt.toISOString(),
                refreshing: REFRESHING.has(athleteId),
                computing: false,
            });
        }

        refreshInBackground(athleteId, stravaCredentials);
        return NextResponse.json({ readings: [], refreshedAt: null, refreshing: true, computing: true });
    } catch (e: any) {
        console.error('Ftp route error:', e);
        return NextResponse.json({ error: e.message || 'Internal Server Error' }, { status: 500 });
    }
}
