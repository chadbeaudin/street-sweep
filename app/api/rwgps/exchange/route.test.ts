const mockJson = jest.fn();
jest.mock('next/server', () => ({ NextResponse: { json: mockJson } }));

import { POST } from './route';

const post = (body: unknown, cookie = 'rwgps_oauth_state=st8') => POST(new Request('http://localhost/api/rwgps/exchange', { method: 'POST', body: JSON.stringify(body), headers: { cookie } }));
const mockCookieSet = jest.fn();

const ORIGINAL_ENV = process.env;
beforeEach(() => {
    process.env = { ...ORIGINAL_ENV, RWGPS_OAUTH_CLIENT_ID: 'id', RWGPS_OAUTH_CLIENT_SECRET: 'secret', NEXT_PUBLIC_BASE_URL: 'https://example.test' };
    mockJson.mockImplementation((data: unknown, init?: { status?: number }) => ({ status: init?.status ?? 200, _data: data, cookies: { set: mockCookieSet } }));
    jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { process.env = ORIGINAL_ENV; jest.restoreAllMocks(); });

describe('POST /api/rwgps/exchange (#196)', () => {
    it('returns only the access token on success', async () => {
        global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ access_token: 'tok', refresh_token: 'r', user_id: 5 }) }) as unknown as typeof fetch;
        await post({ code: 'c', state: 'st8' });
        expect(mockJson).toHaveBeenLastCalledWith({ access_token: 'tok' });
        expect(mockCookieSet).toHaveBeenCalledWith('rwgps_oauth_state', '', { maxAge: 0, path: '/' });
    });

    it('does not echo the upstream OAuth error body', async () => {
        global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({ error: 'invalid_client', error_description: 'client authentication failed for app 1234' }) }) as unknown as typeof fetch;
        await post({ code: 'c', state: 'st8' });
        expect(mockJson).toHaveBeenLastCalledWith({ error: 'Connecting to RideWithGPS failed. Try again.' }, { status: 401 });
    });

    it('does not echo a network failure', async () => {
        global.fetch = jest.fn().mockRejectedValue(new TypeError('getaddrinfo ENOTFOUND ridewithgps.com')) as unknown as typeof fetch;
        await post({ code: 'c', state: 'st8' });
        expect(mockJson).toHaveBeenLastCalledWith({ error: 'Connecting to RideWithGPS failed. Try again.' }, { status: 500 });
    });

    it('rejects a missing or mismatched state before contacting RideWithGPS (#195)', async () => {
        global.fetch = jest.fn() as unknown as typeof fetch;
        for (const [body, cookie] of [[{ code: 'c', state: 'other' }, 'rwgps_oauth_state=st8'], [{ code: 'c' }, 'rwgps_oauth_state=st8'], [{ code: 'c', state: 'st8' }, '']] as const) {
            await post(body, cookie);
            expect(mockJson).toHaveBeenLastCalledWith({ error: 'Invalid state. Please try connecting again.' }, { status: 400 });
        }
        expect(global.fetch).not.toHaveBeenCalled();
    });

    it('sends the configured redirect_uri, ignoring forwarded host headers (#195)', async () => {
        global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ access_token: 'tok' }) }) as unknown as typeof fetch;
        await POST(new Request('http://localhost/api/rwgps/exchange', { method: 'POST', body: JSON.stringify({ code: 'c', state: 'st8' }), headers: { cookie: 'rwgps_oauth_state=st8', 'x-forwarded-host': 'evil.test', host: 'evil.test' } }));
        const sent = new URLSearchParams((global.fetch as jest.Mock).mock.calls[0][1].body);
        expect(sent.get('redirect_uri')).toBe('https://example.test/rwgps-auth');
    });
});
