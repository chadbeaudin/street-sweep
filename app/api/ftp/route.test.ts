const mockJson = jest.fn((data: any, init?: { status?: number }) => ({
    status: init?.status ?? 200,
    _data: data,
}));

jest.mock('next/server', () => ({ NextResponse: { json: mockJson } }));
jest.mock('@/lib/strava', () => ({
    fetchFtpReadings: jest.fn(),
    resolveAthleteId: jest.fn().mockResolvedValue('athlete-1'),
}));
jest.mock('@/lib/prisma', () => ({
    prisma: { ftpReadingCache: { findUnique: jest.fn(), upsert: jest.fn() } },
}));
jest.mock('@/lib/serverStravaCredentials', () => ({ resolveRequestStravaCredentials: jest.fn() }));

import { POST } from './route';
import { resolveAthleteId, fetchFtpReadings } from '@/lib/strava';
import { prisma } from '@/lib/prisma';
import { resolveRequestStravaCredentials } from '@/lib/serverStravaCredentials';

const mockedResolveAthleteId = resolveAthleteId as jest.MockedFunction<typeof resolveAthleteId>;
const mockedFindUnique = prisma.ftpReadingCache.findUnique as jest.MockedFunction<typeof prisma.ftpReadingCache.findUnique>;
const mockedResolveCreds = resolveRequestStravaCredentials as jest.MockedFunction<typeof resolveRequestStravaCredentials>;
const mockedFetchFtp = fetchFtpReadings as jest.MockedFunction<typeof fetchFtpReadings>;
const SIGNED_IN = { refreshToken: 'session-tok' };

beforeEach(() => {
    jest.clearAllMocks();
    mockedResolveAthleteId.mockResolvedValue('athlete-1');
    mockedResolveCreds.mockResolvedValue(SIGNED_IN);
    mockedFindUnique.mockResolvedValue(null);
});

function makeRequest(body: any): Request {
    return new Request('http://localhost/api/ftp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
}

describe('POST /api/ftp', () => {
    it('rejects a caller who is not signed in with Strava (#126)', async () => {
        mockedResolveCreds.mockResolvedValueOnce(null);
        await POST(makeRequest({ stravaCredentials: { refreshToken: 'client-tok' } }));
        const [, init] = mockJson.mock.calls[0];
        expect(init?.status).toBe(401);
        expect(mockedResolveAthleteId).not.toHaveBeenCalled();
    });

    it('uses the resolved credentials, never the body as-is (#126)', async () => {
        const sent = { refreshToken: 'client-tok' };
        await POST(makeRequest({ stravaCredentials: sent }));
        expect(mockedResolveCreds).toHaveBeenCalledWith(sent);
        expect(mockedResolveAthleteId).toHaveBeenCalledWith(SIGNED_IN);
    });

    it('refreshes a stale cache incrementally from its stored scan state (#148)', async () => {
        const readings = [{ value: 250, date: '2024-01-01T00:00:00Z', activityId: 1 }];
        const scanned = { '1': 1 };
        mockedFindUnique.mockResolvedValueOnce({ athleteId: 'athlete-1', readings, scanned, refreshedAt: new Date(0) } as any);
        mockedFetchFtp.mockResolvedValueOnce({ readings, scanned });
        await POST(makeRequest({}));
        expect(mockedFetchFtp).toHaveBeenCalledWith(SIGNED_IN, { readings, scanned });
        await new Promise(r => setImmediate(r));
        expect(prisma.ftpReadingCache.upsert).toHaveBeenCalledWith(expect.objectContaining({ update: expect.objectContaining({ scanned }) }));
    });

    it('does a full scan for a row cached before scan state existed', async () => {
        mockedFindUnique.mockResolvedValueOnce({ athleteId: 'athlete-1', readings: [], scanned: null, refreshedAt: new Date(0) } as any);
        mockedFetchFtp.mockResolvedValueOnce({ readings: [], scanned: {} });
        await POST(makeRequest({}));
        expect(mockedFetchFtp).toHaveBeenCalledWith(SIGNED_IN, undefined);
    });
});
