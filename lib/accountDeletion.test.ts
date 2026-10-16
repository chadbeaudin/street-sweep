import fs from 'fs';
import path from 'path';

jest.mock('./prisma', () => ({
    prisma: {
        user: { findUnique: jest.fn(), delete: jest.fn() },
        riddenRoadsTile: { deleteMany: jest.fn() },
        riddenRoadsJob: { deleteMany: jest.fn() },
        statsCache: { deleteMany: jest.fn() },
        stravaActivityCache: { deleteMany: jest.fn() },
        stravaActivityDetail: { deleteMany: jest.fn() },
        stravaActivityStream: { deleteMany: jest.fn() },
        ftpReadingCache: { deleteMany: jest.fn() },
        stravaSyncEvent: { deleteMany: jest.fn() },
        $transaction: jest.fn(),
    },
}));
jest.mock('./tokenCrypto', () => ({ decryptToken: jest.fn() }));
jest.mock('./strava', () => ({ getStravaAccessToken: jest.fn(), resolveAthleteId: jest.fn() }));

import { deleteAccount } from './accountDeletion';
import { prisma } from './prisma';
import { getStravaAccessToken, resolveAthleteId } from './strava';
import { decryptToken } from './tokenCrypto';

const mockedFindUser = prisma.user.findUnique as jest.Mock;
const mockedGetAccessToken = getStravaAccessToken as jest.Mock;
const fetchMock = jest.fn();
const originalServerRefreshToken = process.env.STRAVA_REFRESH_TOKEN;

afterAll(() => {
    if (originalServerRefreshToken === undefined) delete process.env.STRAVA_REFRESH_TOKEN;
    else process.env.STRAVA_REFRESH_TOKEN = originalServerRefreshToken;
});

const stravaUser = {
    id: 'user-1',
    athleteId: '42',
    accounts: [{ provider: 'strava', refresh_token: 'enc-refresh' }],
};

beforeEach(() => {
    jest.clearAllMocks();
    fetchMock.mockResolvedValue({ ok: true });
    global.fetch = fetchMock as unknown as typeof fetch;
    mockedGetAccessToken.mockResolvedValue('access-123');
    (resolveAthleteId as jest.Mock).mockResolvedValue('server-athlete');
    process.env.STRAVA_REFRESH_TOKEN = 'server-refresh';
    (decryptToken as jest.Mock).mockImplementation((t: string) => `decrypted:${t}`);
    (prisma.$transaction as jest.Mock).mockImplementation(async (ops: unknown[]) => ops);
});

describe('deleteAccount', () => {
    it('deletes every athlete-keyed row, including running-mode keys, and the user', async () => {
        mockedFindUser.mockResolvedValue(stravaUser);
        await deleteAccount('user-1');

        expect(prisma.riddenRoadsTile.deleteMany).toHaveBeenCalledWith({ where: { athleteKey: { in: ['42', '42__running'] } } });
        expect(prisma.statsCache.deleteMany).toHaveBeenCalledWith({ where: { athleteId: { in: ['42', '42__running'] } } });
        expect(prisma.riddenRoadsJob.deleteMany).toHaveBeenCalledWith({ where: { athleteId: '42' } });
        expect(prisma.stravaActivityCache.deleteMany).toHaveBeenCalledWith({ where: { athleteId: '42' } });
        expect(prisma.stravaActivityDetail.deleteMany).toHaveBeenCalledWith({ where: { athleteId: '42' } });
        expect(prisma.stravaActivityStream.deleteMany).toHaveBeenCalledWith({ where: { athleteId: '42' } });
        expect(prisma.ftpReadingCache.deleteMany).toHaveBeenCalledWith({ where: { athleteId: '42' } });
        expect(prisma.stravaSyncEvent.deleteMany).toHaveBeenCalledWith({ where: { athleteId: '42' } });
        expect(prisma.user.delete).toHaveBeenCalledWith({ where: { id: 'user-1' } });
        expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    });

    it('covers every athlete-keyed model in the Prisma schema', async () => {
        const schema = fs.readFileSync(path.join(__dirname, '..', 'prisma', 'schema.prisma'), 'utf8');
        const athleteModels = Array.from(schema.matchAll(/model (\w+) \{([^}]*)\}/g))
            .filter(([, name, body]) => name !== 'User' && /^\s*(athleteId|athleteKey)\s/m.test(body))
            .map(([, name]) => name.charAt(0).toLowerCase() + name.slice(1));
        expect(athleteModels.length).toBeGreaterThan(0);

        mockedFindUser.mockResolvedValue(stravaUser);
        await deleteAccount('user-1');

        const delegates = prisma as unknown as Record<string, { deleteMany?: jest.Mock }>;
        for (const model of athleteModels) {
            expect({ model, deleted: delegates[model]?.deleteMany?.mock.calls.length ?? 0 }).toEqual({ model, deleted: 1 });
        }
    });

    it("revokes Strava access using the user's own decrypted refresh token", async () => {
        mockedFindUser.mockResolvedValue(stravaUser);
        await deleteAccount('user-1');

        expect(mockedGetAccessToken).toHaveBeenCalledWith({ refreshToken: 'decrypted:enc-refresh' });
        expect(fetchMock).toHaveBeenCalledWith('https://www.strava.com/oauth/deauthorize', expect.objectContaining({ method: 'POST' }));
        const body = fetchMock.mock.calls[0][1].body as URLSearchParams;
        expect(body.get('access_token')).toBe('access-123');
    });

    it("does not revoke Strava access when the user is the server's shared Strava athlete", async () => {
        mockedFindUser.mockResolvedValue(stravaUser);
        (resolveAthleteId as jest.Mock).mockResolvedValue('42');
        await deleteAccount('user-1');

        expect(fetchMock).not.toHaveBeenCalled();
        expect(prisma.user.delete).toHaveBeenCalledWith({ where: { id: 'user-1' } });
    });

    it("does not revoke Strava access when the server's shared athlete can't be determined", async () => {
        mockedFindUser.mockResolvedValue(stravaUser);
        (resolveAthleteId as jest.Mock).mockRejectedValue(new Error('strava down'));
        await deleteAccount('user-1');

        expect(fetchMock).not.toHaveBeenCalled();
        expect(prisma.user.delete).toHaveBeenCalled();
    });

    it('revokes Strava access when no shared server token is configured', async () => {
        delete process.env.STRAVA_REFRESH_TOKEN;
        mockedFindUser.mockResolvedValue(stravaUser);
        await deleteAccount('user-1');

        expect(resolveAthleteId).not.toHaveBeenCalled();
        expect(fetchMock).toHaveBeenCalledWith('https://www.strava.com/oauth/deauthorize', expect.anything());
    });

    it('still deletes the data when Strava deauthorization fails', async () => {
        mockedFindUser.mockResolvedValue(stravaUser);
        mockedGetAccessToken.mockRejectedValue(new Error('invalid refresh token'));
        jest.spyOn(console, 'warn').mockImplementation(() => {});

        await deleteAccount('user-1');

        expect(prisma.user.delete).toHaveBeenCalledWith({ where: { id: 'user-1' } });
        expect(prisma.stravaActivityStream.deleteMany).toHaveBeenCalled();
    });

    it('skips Strava when the stored token decrypts to nothing, rather than falling back to the shared server token', async () => {
        mockedFindUser.mockResolvedValue(stravaUser);
        (decryptToken as jest.Mock).mockReturnValue('');
        await deleteAccount('user-1');

        expect(mockedGetAccessToken).not.toHaveBeenCalled();
        expect(prisma.user.delete).toHaveBeenCalled();
    });

    it('never calls Strava without a stored refresh token, so the shared server token is never revoked', async () => {
        mockedFindUser.mockResolvedValue({ id: 'user-2', athleteId: null, accounts: [{ provider: 'google', refresh_token: 'g' }] });
        await deleteAccount('user-2');

        expect(mockedGetAccessToken).not.toHaveBeenCalled();
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('only deletes the user when no Strava athlete is linked', async () => {
        mockedFindUser.mockResolvedValue({ id: 'user-2', athleteId: null, accounts: [] });
        await deleteAccount('user-2');

        expect(prisma.stravaActivityDetail.deleteMany).not.toHaveBeenCalled();
        expect(prisma.riddenRoadsTile.deleteMany).not.toHaveBeenCalled();
        expect(prisma.user.delete).toHaveBeenCalledWith({ where: { id: 'user-2' } });
    });

    it('does nothing when the user no longer exists', async () => {
        mockedFindUser.mockResolvedValue(null);
        await deleteAccount('gone');

        expect(prisma.$transaction).not.toHaveBeenCalled();
        expect(fetchMock).not.toHaveBeenCalled();
    });
});
