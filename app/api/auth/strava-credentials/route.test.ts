// This endpoint used to return the decrypted Strava refresh_token directly
// to the client -- a security review flagged that as excessive exposure
// (cacheable, XSS-reachable, outlives the session). It now only reports
// whether the session has a linked Strava account; the real routes that need
// the token (app/api/strava/activities, app/api/ridden-roads) resolve it
// server-side via lib/serverStravaCredentials.ts instead.

const mockJson = jest.fn((data: any, init?: { status?: number }) => ({
    status: init?.status ?? 200,
    _data: data,
    _headers: init && (init as any).headers,
}));

jest.mock('next/server', () => ({
    NextResponse: { json: mockJson },
}));

const mockGetSessionStravaCredentials = jest.fn();
jest.mock('@/lib/serverStravaCredentials', () => ({
    getSessionStravaCredentials: (...args: any[]) => mockGetSessionStravaCredentials(...args),
}));

import { GET } from './route';

describe('GET /api/auth/strava-credentials', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockJson.mockImplementation((data: any, init?: { status?: number }) => ({
            status: init?.status ?? 200,
            _data: data,
            _headers: init && (init as any).headers,
        }));
    });

    it('reports connected: true without ever including a token, when a Strava account is linked', async () => {
        mockGetSessionStravaCredentials.mockResolvedValue({ refreshToken: 'super-secret-token' });
        const res: any = await GET();
        expect(res._data).toEqual({ connected: true });
        expect(JSON.stringify(res._data)).not.toContain('super-secret-token');
    });

    it('reports connected: false when there is no linked Strava account', async () => {
        mockGetSessionStravaCredentials.mockResolvedValue(null);
        const res: any = await GET();
        expect(res._data).toEqual({ connected: false });
    });

    it('sets Cache-Control: no-store', async () => {
        mockGetSessionStravaCredentials.mockResolvedValue(null);
        const res: any = await GET();
        expect(res._headers).toEqual({ 'Cache-Control': 'no-store' });
    });
});
