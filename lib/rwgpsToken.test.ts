const mockGetServerSession = jest.fn();
jest.mock('next-auth', () => ({ getServerSession: (...args: unknown[]) => mockGetServerSession(...args) }));
jest.mock('./auth', () => ({ authOptions: {} }));

const mockUpsert = jest.fn();
const mockFindFirst = jest.fn();
jest.mock('./prisma', () => ({ prisma: { account: { upsert: (...a: unknown[]) => mockUpsert(...a), findFirst: (...a: unknown[]) => mockFindFirst(...a) } } }));

import { sessionUserId, saveRwgpsToken, getRwgpsToken } from './rwgpsToken';

const ORIGINAL_ENV = process.env;
beforeEach(() => {
    process.env = { ...ORIGINAL_ENV, ACCOUNT_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64') };
});
afterEach(() => { process.env = ORIGINAL_ENV; });

describe('rwgpsToken (#194)', () => {
    it('reads the user id from the session', async () => {
        mockGetServerSession.mockResolvedValue({ user: { id: 'u1' } });
        expect(await sessionUserId()).toBe('u1');
        mockGetServerSession.mockResolvedValue(null);
        expect(await sessionUserId()).toBeNull();
    });

    it('stores the token encrypted and reads it back', async () => {
        await saveRwgpsToken('u1', 'tok-123');
        const { create, update, where } = mockUpsert.mock.calls[0][0];
        expect(where).toEqual({ provider_providerAccountId: { provider: 'rwgps', providerAccountId: 'u1' } });
        expect(create.access_token).toMatch(/^v1:/);
        expect(create.access_token).not.toContain('tok-123');
        expect(update.access_token).toMatch(/^v1:/);

        mockFindFirst.mockResolvedValue({ access_token: create.access_token });
        expect(await getRwgpsToken('u1')).toBe('tok-123');
        expect(mockFindFirst).toHaveBeenCalledWith({ where: { userId: 'u1', provider: 'rwgps' } });
    });

    it('returns null when there is no connection or the stored value is unreadable', async () => {
        mockFindFirst.mockResolvedValue(null);
        expect(await getRwgpsToken('u1')).toBeNull();
        mockFindFirst.mockResolvedValue({ access_token: 'plaintext' });
        expect(await getRwgpsToken('u1')).toBeNull();
    });
});
