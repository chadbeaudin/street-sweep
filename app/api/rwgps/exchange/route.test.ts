const mockJson = jest.fn();
jest.mock('next/server', () => ({ NextResponse: { json: mockJson } }));

import { POST } from './route';

const post = (body: unknown) => POST(new Request('http://localhost/api/rwgps/exchange', { method: 'POST', body: JSON.stringify(body) }));

const ORIGINAL_ENV = process.env;
beforeEach(() => {
    process.env = { ...ORIGINAL_ENV, RWGPS_OAUTH_CLIENT_ID: 'id', RWGPS_OAUTH_CLIENT_SECRET: 'secret', NEXT_PUBLIC_BASE_URL: 'https://example.test' };
    mockJson.mockImplementation((data: unknown, init?: { status?: number }) => ({ status: init?.status ?? 200, _data: data }));
    jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { process.env = ORIGINAL_ENV; jest.restoreAllMocks(); });

describe('POST /api/rwgps/exchange (#196)', () => {
    it('returns only the access token on success', async () => {
        global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ access_token: 'tok', refresh_token: 'r', user_id: 5 }) }) as unknown as typeof fetch;
        await post({ code: 'c' });
        expect(mockJson).toHaveBeenLastCalledWith({ access_token: 'tok' });
    });

    it('does not echo the upstream OAuth error body', async () => {
        global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({ error: 'invalid_client', error_description: 'client authentication failed for app 1234' }) }) as unknown as typeof fetch;
        await post({ code: 'c' });
        expect(mockJson).toHaveBeenLastCalledWith({ error: 'Connecting to RideWithGPS failed. Try again.' }, { status: 401 });
    });

    it('does not echo a network failure', async () => {
        global.fetch = jest.fn().mockRejectedValue(new TypeError('getaddrinfo ENOTFOUND ridewithgps.com')) as unknown as typeof fetch;
        await post({ code: 'c' });
        expect(mockJson).toHaveBeenLastCalledWith({ error: 'Connecting to RideWithGPS failed. Try again.' }, { status: 500 });
    });
});
