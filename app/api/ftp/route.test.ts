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
import { resolveAthleteId } from '@/lib/strava';
import { prisma } from '@/lib/prisma';
import { resolveRequestStravaCredentials } from '@/lib/serverStravaCredentials';

const mockedResolveAthleteId = resolveAthleteId as jest.MockedFunction<typeof resolveAthleteId>;
const mockedFindUnique = prisma.ftpReadingCache.findUnique as jest.MockedFunction<typeof prisma.ftpReadingCache.findUnique>;
const mockedResolveCreds = resolveRequestStravaCredentials as jest.MockedFunction<typeof resolveRequestStravaCredentials>;
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
});
