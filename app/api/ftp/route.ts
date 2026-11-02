import { withApiMetrics } from '@/lib/metrics';
import { NextResponse } from 'next/server';
import { fetchFtpReadings, resolveAthleteId, FtpScanResult, FtpScanState } from '@/lib/strava';
import type { FtpReading } from '@/lib/ftp';
import { prisma } from '@/lib/prisma';
import { resolveRequestStravaCredentials } from '@/lib/serverStravaCredentials';

const ts = () => `[${new Date().toTimeString().slice(0, 8)}]`;
const FRESH_TTL_MS = 24 * 60 * 60 * 1000;

interface Creds { clientId?: string; clientSecret?: string; refreshToken?: string }

const REFRESHING = new Set<string>();

async function refreshInBackground(athleteId: string, creds: Creds, previous?: FtpScanResult) {
    if (REFRESHING.has(athleteId)) return;
    REFRESHING.add(athleteId);
    try {
        console.log(`${ts()} Ftp: refresh starting for ${athleteId}`);
        const { readings, scanned } = await fetchFtpReadings(creds, previous);
        await prisma.ftpReadingCache.upsert({
            where: { athleteId },
            create: { athleteId, readings: readings as any, scanned, refreshedAt: new Date() },
            update: { readings: readings as any, scanned, refreshedAt: new Date() },
        });
        console.log(`${ts()} Ftp: cached ${readings.length} readings for ${athleteId}`);
    } catch (e: any) {
        console.warn(`${ts()} Ftp refresh failed for ${athleteId}: ${e.message}`);
    } finally {
        REFRESHING.delete(athleteId);
    }
}

async function handlePOST(request: Request) {
    try {
        const body = await request.json() as { stravaCredentials?: Creds };
        const stravaCredentials = await resolveRequestStravaCredentials(body.stravaCredentials);
        if (!stravaCredentials) return NextResponse.json({ error: 'Sign in with Strava first' }, { status: 401 });
        const athleteId = await resolveAthleteId(stravaCredentials);
        const cached = await prisma.ftpReadingCache.findUnique({ where: { athleteId } });

        if (cached) {
            const stale = Date.now() - cached.refreshedAt.getTime() > FRESH_TTL_MS;
            // Rows cached before #148 have no scan state, so their first refresh is a full scan.
            if (stale) refreshInBackground(athleteId, stravaCredentials, cached.scanned ? { readings: cached.readings as unknown as FtpReading[], scanned: cached.scanned as FtpScanState } : undefined);
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

export const POST = withApiMetrics('POST', '/api/ftp', handlePOST);
