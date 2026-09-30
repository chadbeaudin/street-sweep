const mockJson = jest.fn((data: any, init?: { status?: number }) => ({
    status: init?.status ?? 200,
    _data: data,
}));

jest.mock('next/server', () => ({ NextResponse: { json: mockJson } }));
const mockResolveAthleteId = jest.fn();
jest.mock('@/lib/strava', () => ({ resolveAthleteId: (...args: any[]) => mockResolveAthleteId(...args) }));
jest.mock('@/lib/serverStravaCredentials', () => ({ getSessionStravaCredentials: jest.fn() }));

const mockGetCachedRiddenTiles = jest.fn();
const mockRefreshInBackground = jest.fn();
jest.mock('@/lib/riddenRoadsRefresh', () => ({
    riddenRoadsCacheKey: (athleteId: string, mode: string) => (mode === 'running' ? `${athleteId}__running` : athleteId),
    refreshRiddenRoadsInBackground: (...args: any[]) => mockRefreshInBackground(...args),
    getCachedRiddenTiles: (...args: any[]) => mockGetCachedRiddenTiles(...args),
    tilesForBbox: () => ['1,2', '1,3'],
    MAX_TILES: 400,
}));

import { POST } from './route';
import { getSessionStravaCredentials } from '@/lib/serverStravaCredentials';

const mockedGetSessionCreds = getSessionStravaCredentials as jest.MockedFunction<typeof getSessionStravaCredentials>;
const bbox = { south: 0, north: 1, west: 0, east: 1 };

function makeRequest(body: any): Request {
    return new Request('http://localhost/api/ridden-roads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
}

beforeEach(() => {
    jest.clearAllMocks();
    mockedGetSessionCreds.mockResolvedValue(null);
    mockResolveAthleteId.mockResolvedValue('athlete-1');
});

describe('POST /api/ridden-roads', () => {
    it('requires a refreshToken', async () => {
        await POST(makeRequest({ bbox }));
        const [data, init] = mockJson.mock.calls[0];
        expect(init.status).toBe(400);
        expect(data.error).toMatch(/refreshToken/);
    });

    it('requires a bbox -- it never matches a rider'+"'"+'s whole history in one shot', async () => {
        await POST(makeRequest({ stravaCredentials: { refreshToken: 'tok' } }));
        const [data, init] = mockJson.mock.calls[0];
        expect(init.status).toBe(400);
        expect(data.error).toMatch(/bbox/);
    });

    it('returns cached roads and does not enqueue anything when every tile is fresh', async () => {
        mockGetCachedRiddenTiles.mockResolvedValue({ roads: [[[0, 0], [1, 1]]], refreshedAt: '2026-01-01T00:00:00Z', missing: [] });
        await POST(makeRequest({ stravaCredentials: { refreshToken: 'tok' }, bbox }));
        expect(mockRefreshInBackground).not.toHaveBeenCalled();
        const [data] = mockJson.mock.calls[0];
        expect(data).toEqual({ roads: [[[0, 0], [1, 1]]], refreshedAt: '2026-01-01T00:00:00Z', refreshing: false, computing: false });
    });

    it('enqueues only the missing tiles, scoped to the requested bbox', async () => {
        mockGetCachedRiddenTiles.mockResolvedValue({ roads: [], refreshedAt: null, missing: ['1,2', '1,3'] });
        const creds = { refreshToken: 'tok' };
        await POST(makeRequest({ stravaCredentials: creds, bbox }));
        expect(mockRefreshInBackground).toHaveBeenCalledWith('athlete-1', creds, 'cycling', ['1,2', '1,3']);
        const [data] = mockJson.mock.calls[0];
        expect(data.refreshing).toBe(true);
        expect(data.computing).toBe(true);
    });

    it('reports refreshing but not computing when some tiles are cached and others are still pending', async () => {
        mockGetCachedRiddenTiles.mockResolvedValue({ roads: [[[0, 0], [1, 1]]], refreshedAt: '2026-01-01T00:00:00Z', missing: ['1,3'] });
        await POST(makeRequest({ stravaCredentials: { refreshToken: 'tok' }, bbox }));
        const [data] = mockJson.mock.calls[0];
        expect(data.refreshing).toBe(true);
        expect(data.computing).toBe(false);
    });

    it('uses the mode-suffixed cache key for running', async () => {
        mockGetCachedRiddenTiles.mockResolvedValue({ roads: [], refreshedAt: null, missing: ['1,2'] });
        const creds = { refreshToken: 'tok' };
        await POST(makeRequest({ stravaCredentials: creds, activityMode: 'running', bbox }));
        expect(mockRefreshInBackground).toHaveBeenCalledWith('athlete-1', creds, 'running', ['1,2']);
    });

    it('resolves the refresh token from the session when the client sends none', async () => {
        mockedGetSessionCreds.mockResolvedValueOnce({ refreshToken: 'session-tok' });
        mockGetCachedRiddenTiles.mockResolvedValue({ roads: [], refreshedAt: null, missing: [] });
        await POST(makeRequest({ bbox }));
        const [data, init] = mockJson.mock.calls[0];
        expect(init?.status ?? 200).toBe(200);
        expect(data).not.toHaveProperty('error');
    });
});
