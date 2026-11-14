const mockCookieSet = jest.fn();
const mockRedirect = jest.fn();
jest.mock('next/server', () => ({ NextResponse: { redirect: mockRedirect, json: jest.fn() } }));

import { GET } from './route';

const get = () => GET();

const ORIGINAL_ENV = process.env;
beforeEach(() => {
    process.env = { ...ORIGINAL_ENV, RWGPS_OAUTH_CLIENT_ID: 'id', NEXTAUTH_URL: 'https://app.test', NEXT_PUBLIC_BASE_URL: '' };
    mockRedirect.mockImplementation(() => ({ cookies: { set: mockCookieSet } }));
});
afterEach(() => { process.env = ORIGINAL_ENV; jest.clearAllMocks(); });

describe('GET /api/rwgps/auth (#195)', () => {
    it('builds redirect_uri from configuration, not request headers', async () => {
        await get();
        const authorizeUrl = new URL(mockRedirect.mock.calls[0][0]);
        expect(authorizeUrl.searchParams.get('redirect_uri')).toBe('https://app.test/rwgps-auth');
    });

    it('fails when no base URL is configured', async () => {
        process.env.NEXTAUTH_URL = '';
        await expect(get()).rejects.toThrow();
        expect(mockRedirect).not.toHaveBeenCalled();
    });

    it('sets the state cookie httpOnly, matching the state sent to RideWithGPS', async () => {
        await get();
        const state = new URL(mockRedirect.mock.calls[0][0]).searchParams.get('state');
        expect(mockCookieSet).toHaveBeenCalledWith('rwgps_oauth_state', state, expect.objectContaining({ httpOnly: true, sameSite: 'lax' }));
    });

    it('marks the state cookie secure in production', async () => {
        Object.assign(process.env, { NODE_ENV: 'production' });
        await get();
        expect(mockCookieSet).toHaveBeenCalledWith('rwgps_oauth_state', expect.any(String), expect.objectContaining({ secure: true }));
    });
});
