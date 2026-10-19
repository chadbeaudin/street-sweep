const mockGetServerSession = jest.fn();
jest.mock('next-auth', () => ({ getServerSession: (...args: any[]) => mockGetServerSession(...args) }));
jest.mock('./auth', () => ({ authOptions: {} }));

const mockFindFirst = jest.fn();
jest.mock('./prisma', () => ({ prisma: { account: { findFirst: (...args: any[]) => mockFindFirst(...args) } } }));

const mockDecryptToken = jest.fn();
jest.mock('./tokenCrypto', () => ({ decryptToken: (...args: any[]) => mockDecryptToken(...args) }));

const flags = { advancedStravaIntegration: false };
jest.mock('./featureFlags', () => ({ featureFlags: flags }));

import { getSessionStravaCredentials, resolveRequestStravaCredentials } from './serverStravaCredentials';

describe('getSessionStravaCredentials', () => {
    beforeEach(() => jest.clearAllMocks());

    it('returns null when there is no session', async () => {
        mockGetServerSession.mockResolvedValue(null);
        expect(await getSessionStravaCredentials()).toBeNull();
        expect(mockFindFirst).not.toHaveBeenCalled();
    });

    it('returns null when the session user has no linked Strava account', async () => {
        mockGetServerSession.mockResolvedValue({ user: { id: 'user1' } });
        mockFindFirst.mockResolvedValue(null);
        expect(await getSessionStravaCredentials()).toBeNull();
    });

    it('returns null when decryption fails, rather than throwing', async () => {
        mockGetServerSession.mockResolvedValue({ user: { id: 'user1' } });
        mockFindFirst.mockResolvedValue({ refresh_token: 'bad-blob' });
        mockDecryptToken.mockImplementation(() => { throw new Error('bad decrypt'); });
        expect(await getSessionStravaCredentials()).toBeNull();
    });

    it('returns the decrypted refresh token for a linked account', async () => {
        mockGetServerSession.mockResolvedValue({ user: { id: 'user1' } });
        mockFindFirst.mockResolvedValue({ refresh_token: 'encrypted-blob' });
        mockDecryptToken.mockReturnValue('plain-refresh-token');
        expect(await getSessionStravaCredentials()).toEqual({ refreshToken: 'plain-refresh-token' });
        expect(mockFindFirst).toHaveBeenCalledWith({ where: { userId: 'user1', provider: 'strava' } });
    });
});

describe('resolveRequestStravaCredentials (#126)', () => {
    const own = { clientId: ' id ', clientSecret: ' secret ', refreshToken: ' tok ' };
    beforeEach(() => {
        jest.clearAllMocks();
        flags.advancedStravaIntegration = false;
        mockGetServerSession.mockResolvedValue({ user: { id: 'user1' } });
        mockFindFirst.mockResolvedValue({ refresh_token: 'encrypted-blob' });
        mockDecryptToken.mockReturnValue('session-token');
    });

    it('uses the signed-in session and ignores credentials sent in the request', async () => {
        expect(await resolveRequestStravaCredentials({ refreshToken: 'client-supplied' })).toEqual({ refreshToken: 'session-token' });
        expect(await resolveRequestStravaCredentials(own)).toEqual({ refreshToken: 'session-token' });
    });

    it('returns null for an anonymous caller, so nobody falls through to the server account', async () => {
        mockGetServerSession.mockResolvedValue(null);
        expect(await resolveRequestStravaCredentials({ refreshToken: 'client-supplied' })).toBeNull();
    });

    it('accepts a complete own-app credential set only in advanced mode', async () => {
        flags.advancedStravaIntegration = true;
        expect(await resolveRequestStravaCredentials(own)).toEqual({ clientId: 'id', clientSecret: 'secret', refreshToken: 'tok' });
        expect(mockGetServerSession).not.toHaveBeenCalled();
        expect(await resolveRequestStravaCredentials({ refreshToken: 'tok' })).toEqual({ refreshToken: 'session-token' });
    });
});
