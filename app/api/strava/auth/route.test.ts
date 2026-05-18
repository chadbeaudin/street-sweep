// Tests for issues #15 (OAuth state parameter) and #17 (hardcoded redirect_uri).

const mockRedirect = jest.fn((url: string) => ({ status: 302, _url: url }));
const mockJson = jest.fn((data: any, init?: { status?: number }) => ({
    status: init?.status ?? 200,
    _data: data,
}));

jest.mock('next/server', () => ({
    NextResponse: { redirect: mockRedirect, json: mockJson },
}));

import { GET } from './route';

function makeRequest(headers: Record<string, string> = {}): Request {
    return new Request('http://localhost:3888/api/strava/auth', { headers });
}

function getRedirectUrl(): URL {
    const raw = mockRedirect.mock.calls[0][0] as string;
    return new URL(raw);
}

describe('GET /api/strava/auth', () => {
    beforeEach(() => {
        process.env.STRAVA_CLIENT_ID = 'test_client_id';
    });

    it('returns 500 when STRAVA_CLIENT_ID is not set', async () => {
        delete process.env.STRAVA_CLIENT_ID;
        await GET(makeRequest());
        expect(mockJson).toHaveBeenCalled();
        expect(mockJson.mock.calls[0][1]?.status).toBe(500);
    });

    it('redirects to Strava authorization URL', async () => {
        await GET(makeRequest());
        expect(mockRedirect).toHaveBeenCalled();
        const url = getRedirectUrl();
        expect(url.hostname).toBe('www.strava.com');
        expect(url.pathname).toBe('/oauth/authorize');
    });

    it('includes state parameter in the authorization URL', async () => {
        await GET(makeRequest());
        const url = getRedirectUrl();
        const state = url.searchParams.get('state');
        expect(state).toBeTruthy();
        expect(state!.length).toBeGreaterThanOrEqual(16);
    });

    it('generates a different state value on each request', async () => {
        await GET(makeRequest());
        const state1 = getRedirectUrl().searchParams.get('state');
        mockRedirect.mockClear();
        await GET(makeRequest());
        const state2 = getRedirectUrl().searchParams.get('state');
        expect(state1).not.toBe(state2);
    });

    it('uses NEXT_PUBLIC_BASE_URL env var for redirect_uri, ignoring Host header', async () => {
        process.env.NEXT_PUBLIC_BASE_URL = 'https://myapp.example.com';
        await GET(makeRequest({ host: 'attacker.com' }));
        const url = getRedirectUrl();
        const redirectUri = url.searchParams.get('redirect_uri');
        expect(redirectUri).toContain('myapp.example.com');
        expect(redirectUri).not.toContain('attacker.com');
        delete process.env.NEXT_PUBLIC_BASE_URL;
    });

    it('uses NEXT_PUBLIC_BASE_URL env var, ignoring x-forwarded-host header', async () => {
        process.env.NEXT_PUBLIC_BASE_URL = 'https://myapp.example.com';
        await GET(makeRequest({ 'x-forwarded-host': 'evil.com', 'x-forwarded-proto': 'https' }));
        const url = getRedirectUrl();
        const redirectUri = url.searchParams.get('redirect_uri');
        expect(redirectUri).toContain('myapp.example.com');
        expect(redirectUri).not.toContain('evil.com');
        delete process.env.NEXT_PUBLIC_BASE_URL;
    });

    it('includes correct client_id in authorization URL', async () => {
        await GET(makeRequest());
        const url = getRedirectUrl();
        expect(url.searchParams.get('client_id')).toBe('test_client_id');
    });
});
