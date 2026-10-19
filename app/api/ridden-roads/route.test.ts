const mockJson = jest.fn((data: any, init?: { status?: number }) => ({
    status: init?.status ?? 200,
    _data: data,
}));

jest.mock('next/server', () => ({ NextResponse: { json: mockJson } }));
const mockResolveAthleteId = jest.fn();
jest.mock('@/lib/strava', () => ({ resolveAthleteId: (...args: any[]) => mockResolveAthleteId(...args) }));
jest.mock('@/lib/serverStravaCredentials', () => ({ resolveRequestStravaCredentials: jest.fn() }));

const mockGetCachedRiddenTiles = jest.fn();
const mockRefreshInBackground = jest.fn();
const mockCapTiles = jest.fn();
jest.mock('@/lib/riddenRoadsRefresh', () => ({
    riddenRoadsCacheKey: (athleteId: string, mode: string) => (mode === 'running' ? `${athleteId}__running` : athleteId),
    refreshRiddenRoadsInBackground: (...args: any[]) => mockRefreshInBackground(...args),
    getCachedRiddenTiles: (...args: any[]) => mockGetCachedRiddenTiles(...args),
    tilesForBbox: () => ['1,2', '1,3'],
    capTilesNearCenter: (...args: any[]) => mockCapTiles(...args),
    MAX_TILES: 400,
}));

import { POST } from './route';
import { resolveRequestStravaCredentials } from '@/lib/serverStravaCredentials';

const mockedResolveCreds = resolveRequestStravaCredentials as jest.MockedFunction<typeof resolveRequestStravaCredentials>;
const SIGNED_IN = { refreshToken: 'session-tok' };
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
    mockedResolveCreds.mockResolvedValue(SIGNED_IN);
    mockResolveAthleteId.mockResolvedValue('athlete-1');
    mockCapTiles.mockImplementation((tiles: string[]) => ({ tiles, truncated: false }));
});

describe('POST /api/ridden-roads', () => {
    it('rejects a caller who is not signed in with Strava (#126)', async () => {
        mockedResolveCreds.mockResolvedValueOnce(null);
        await POST(makeRequest({ stravaCredentials: { refreshToken: 'client-supplied' }, bbox }));
        const [, init] = mockJson.mock.calls[0];
        expect(init.status).toBe(401);
        expect(mockResolveAthleteId).not.toHaveBeenCalled();
    });

    it('requires a bbox -- it never matches a rider'+"'"+'s whole history in one shot', async () => {
        await POST(makeRequest({ stravaCredentials: { refreshToken: 'tok' } }));
        const [data, init] = mockJson.mock.calls[0];
        expect(init.status).toBe(400);
        expect(data.error).toMatch(/bbox/);
    });

    it('returns cached roads and does not enqueue anything when every tile is fresh', async () => {
        mockGetCachedRiddenTiles.mockResolvedValue({ tiles: { '1,2': [[[0, 0], [1, 1]]] }, refreshedAt: '2026-01-01T00:00:00Z', missing: [] });
        await POST(makeRequest({ stravaCredentials: { refreshToken: 'tok' }, bbox }));
        expect(mockRefreshInBackground).not.toHaveBeenCalled();
        const [data] = mockJson.mock.calls[0];
        expect(data).toEqual({ tiles: { '1,2': [[[0, 0], [1, 1]]] }, refreshedAt: '2026-01-01T00:00:00Z', refreshing: false, truncated: false, computing: false });
    });

    it('enqueues only the missing tiles, scoped to the requested bbox', async () => {
        mockGetCachedRiddenTiles.mockResolvedValue({ tiles: {}, refreshedAt: null, missing: ['1,2', '1,3'] });
        await POST(makeRequest({ bbox }));
        expect(mockRefreshInBackground).toHaveBeenCalledWith('athlete-1', SIGNED_IN, 'cycling', ['1,2', '1,3']);
        const [data] = mockJson.mock.calls[0];
        expect(data.refreshing).toBe(true);
        expect(data.computing).toBe(true);
    });

    it('reports refreshing but not computing when some tiles are cached and others are still pending', async () => {
        mockGetCachedRiddenTiles.mockResolvedValue({ tiles: { '1,2': [[[0, 0], [1, 1]]] }, refreshedAt: '2026-01-01T00:00:00Z', missing: ['1,3'] });
        await POST(makeRequest({ stravaCredentials: { refreshToken: 'tok' }, bbox }));
        const [data] = mockJson.mock.calls[0];
        expect(data.refreshing).toBe(true);
        expect(data.computing).toBe(false);
    });

    it('uses the mode-suffixed cache key for running', async () => {
        mockGetCachedRiddenTiles.mockResolvedValue({ tiles: {}, refreshedAt: null, missing: ['1,2'] });
        await POST(makeRequest({ activityMode: 'running', bbox }));
        expect(mockRefreshInBackground).toHaveBeenCalledWith('athlete-1', SIGNED_IN, 'running', ['1,2']);
    });

    it('gets credentials only through the shared resolver, never straight from the body (#126)', async () => {
        mockGetCachedRiddenTiles.mockResolvedValue({ tiles: {}, refreshedAt: null, missing: [] });
        const sent = { refreshToken: 'client-supplied' };
        await POST(makeRequest({ stravaCredentials: sent, bbox }));
        expect(mockedResolveCreds).toHaveBeenCalledWith(sent);
        expect(mockResolveAthleteId).toHaveBeenCalledWith(SIGNED_IN);
    });

    it('only looks up the capped tiles and reports truncation when the bbox has too many', async () => {
        mockCapTiles.mockReturnValue({ tiles: ['1,3'], truncated: true });
        mockGetCachedRiddenTiles.mockResolvedValue({ tiles: {}, refreshedAt: null, missing: ['1,3'] });
        await POST(makeRequest({ stravaCredentials: { refreshToken: 'tok' }, bbox }));
        expect(mockCapTiles).toHaveBeenCalledWith(['1,2', '1,3'], bbox, 400);
        expect(mockGetCachedRiddenTiles).toHaveBeenCalledWith('athlete-1', ['1,3'], expect.any(Number));
        const [data] = mockJson.mock.calls[0];
        expect(data.truncated).toBe(true);
    });
});
