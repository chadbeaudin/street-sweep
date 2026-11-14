const mockGetServerSession = jest.fn();
jest.mock('next-auth', () => ({ getServerSession: (...args: any[]) => mockGetServerSession(...args) }));
jest.mock('./auth', () => ({ authOptions: {} }));

const mockFindFirst = jest.fn();
jest.mock('./prisma', () => ({ prisma: { account: { findFirst: (...args: any[]) => mockFindFirst(...args) } } }));

const mockDecryptToken = jest.fn();
jest.mock('./tokenCrypto', () => ({ decryptToken: (...args: any[]) => mockDecryptToken(...args) }));


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
        mockFindFirst.mockResolvedValue({ refresh_token: 'encrypted-blob', providerAccountId: '12345' });
        mockDecryptToken.mockReturnValue('plain-refresh-token');
        expect(await getSessionStravaCredentials()).toEqual({ refreshToken: 'plain-refresh-token', athleteId: '12345' });
        expect(mockFindFirst).toHaveBeenCalledWith({ where: { userId: 'user1', provider: 'strava' } });
    });
});

describe('resolveRequestStravaCredentials (#126)', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockGetServerSession.mockResolvedValue({ user: { id: 'user1' } });
        mockFindFirst.mockResolvedValue({ refresh_token: 'encrypted-blob', providerAccountId: '12345' });
        mockDecryptToken.mockReturnValue('session-token');
    });

    it('uses the signed-in session', async () => {
        expect(await resolveRequestStravaCredentials()).toEqual({ refreshToken: 'session-token', athleteId: '12345' });
    });

    it('returns null for an anonymous caller, so nobody falls through to the server account', async () => {
        mockGetServerSession.mockResolvedValue(null);
        expect(await resolveRequestStravaCredentials()).toBeNull();
    });
});
