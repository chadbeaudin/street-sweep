// Tests for issue #18: token exchange must only return refresh_token.

const mockJson = jest.fn((data: any, init?: { status?: number }) => ({
    status: init?.status ?? 200,
    _data: data,
}));

jest.mock('next/server', () => ({ NextResponse: { json: mockJson } }));

import { POST } from './route';

const stravaTokenResponse = {
    token_type: 'Bearer',
    expires_at: 9999999999,
    expires_in: 21600,
    refresh_token: 'real_refresh_token',
    access_token: 'real_access_token',
    athlete: {
        id: 12345,
        firstname: 'John',
        lastname: 'Doe',
        city: 'Denver',
        state: 'Colorado',
        country: 'US',
        profile: 'https://example.com/photo.jpg',
    },
};

function makeRequest(body: any): Request {
    return new Request('http://localhost/api/strava/exchange', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
}

describe('POST /api/strava/exchange', () => {
    beforeEach(() => {
        process.env.STRAVA_CLIENT_ID = 'test_id';
        process.env.STRAVA_CLIENT_SECRET = 'test_secret';
        global.fetch = jest.fn();
    });

    it('returns only refresh_token on success', async () => {
        (global.fetch as jest.Mock).mockResolvedValueOnce({
            ok: true,
            json: async () => stravaTokenResponse,
        });
        await POST(makeRequest({ code: 'valid_code' }));
        const [data] = mockJson.mock.calls[0];
        expect(data).toHaveProperty('refresh_token', 'real_refresh_token');
        expect(Object.keys(data)).toEqual(['refresh_token']);
    });

    it('does not return access_token to the client', async () => {
        (global.fetch as jest.Mock).mockResolvedValueOnce({
            ok: true,
            json: async () => stravaTokenResponse,
        });
        await POST(makeRequest({ code: 'valid_code' }));
        const [data] = mockJson.mock.calls[0];
        expect(data).not.toHaveProperty('access_token');
    });

    it('does not return athlete PII to the client', async () => {
        (global.fetch as jest.Mock).mockResolvedValueOnce({
            ok: true,
            json: async () => stravaTokenResponse,
        });
        await POST(makeRequest({ code: 'valid_code' }));
        const [data] = mockJson.mock.calls[0];
        expect(data).not.toHaveProperty('athlete');
    });

    it('returns 400 when code is missing', async () => {
        await POST(makeRequest({}));
        const [, init] = mockJson.mock.calls[0];
        expect(init?.status).toBe(400);
    });

    it('returns error status when Strava rejects the code', async () => {
        (global.fetch as jest.Mock).mockResolvedValueOnce({
            ok: false,
            status: 401,
            json: async () => ({ message: 'Authorization Error' }),
        });
        await POST(makeRequest({ code: 'bad_code' }));
        const [, init] = mockJson.mock.calls[0];
        expect(init?.status).toBe(401);
        const [data] = mockJson.mock.calls[0];
        expect(data).not.toHaveProperty('refresh_token');
    });
});
