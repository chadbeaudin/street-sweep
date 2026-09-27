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
jest.mock('@/lib/serverStravaCredentials', () => ({ getSessionStravaCredentials: jest.fn() }));

import { POST } from './route';
import { resolveAthleteId } from '@/lib/strava';
import { prisma } from '@/lib/prisma';
import { getSessionStravaCredentials } from '@/lib/serverStravaCredentials';

const mockedResolveAthleteId = resolveAthleteId as jest.MockedFunction<typeof resolveAthleteId>;
const mockedFindUnique = prisma.ftpReadingCache.findUnique as jest.MockedFunction<typeof prisma.ftpReadingCache.findUnique>;
const mockedGetSessionCreds = getSessionStravaCredentials as jest.MockedFunction<typeof getSessionStravaCredentials>;

beforeEach(() => {
    jest.clearAllMocks();
    mockedResolveAthleteId.mockResolvedValue('athlete-1');
    mockedGetSessionCreds.mockResolvedValue(null);
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
    it('requires a refreshToken when there is neither a client-supplied one nor a session', async () => {
        await POST(makeRequest({}));
        const [data, init] = mockJson.mock.calls[0];
        expect(init?.status).toBe(400);
        expect(data.error).toMatch(/refreshToken required/);
        expect(mockedResolveAthleteId).not.toHaveBeenCalled();
    });

    it('resolves the refresh token from the session when the client sends none (session-linked sign-in)', async () => {
        mockedGetSessionCreds.mockResolvedValueOnce({ refreshToken: 'session-tok' });
        await POST(makeRequest({ stravaCredentials: { sessionLinked: true } }));
        expect(mockedResolveAthleteId).toHaveBeenCalledWith(
            expect.objectContaining({ sessionLinked: true, refreshToken: 'session-tok' }),
        );
    });

    it('does not fall back to the session when the client already supplied a refreshToken', async () => {
        await POST(makeRequest({ stravaCredentials: { refreshToken: 'client-tok' } }));
        expect(mockedGetSessionCreds).not.toHaveBeenCalled();
        expect(mockedResolveAthleteId).toHaveBeenCalledWith(
            expect.objectContaining({ refreshToken: 'client-tok' }),
        );
    });
});
