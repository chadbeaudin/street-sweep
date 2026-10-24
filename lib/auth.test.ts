jest.mock('./prisma', () => ({ prisma: { account: { updateMany: jest.fn() } } }));
jest.mock('@auth/prisma-adapter', () => ({ PrismaAdapter: () => ({}) }));
jest.mock('./tokenCrypto', () => ({ encryptToken: (t: string) => `enc:${t}` }));
jest.mock('./metrics', () => ({ touchUserLastSeen: jest.fn() }));
jest.mock('./telegram', () => ({ sendTelegramMessage: jest.fn() }));

process.env.STRAVA_CLIENT_ID = 'client';
process.env.STRAVA_CLIENT_SECRET = 'secret';

import { authOptions } from './auth';
import { prisma } from './prisma';
import { touchUserLastSeen } from './metrics';
import { sendTelegramMessage } from './telegram';

type StravaProviderOptions = {
    authorization: { params: { scope: string } };
    token: { request: (ctx: { params: Record<string, string> }) => Promise<{ tokens: Record<string, unknown> }> };
};

const strava = () => (authOptions.providers[0] as unknown as { options: StravaProviderOptions }).options;

describe('Strava sign-in', () => {
    it('asks for permission to update activities', () => {
        expect(strava().authorization.params.scope).toBe('read,activity:read,activity:write');
    });

    it('keeps the scopes the user actually granted, which Strava reports on the callback', async () => {
        global.fetch = jest.fn().mockResolvedValue({
            ok: true,
            json: async () => ({ access_token: 'a', refresh_token: 'r', athlete: { id: 1 } }),
        }) as unknown as typeof fetch;

        const { tokens } = await strava().token.request({ params: { code: 'c', scope: 'read,activity:read' } });
        expect(tokens).toEqual({ access_token: 'a', refresh_token: 'r', scope: 'read,activity:read' });
    });

    it('replaces a returning user\'s stored tokens and scope on sign-in', async () => {
        await authOptions.events!.signIn!({
            user: { id: 'u1' },
            account: { provider: 'strava', providerAccountId: '42', type: 'oauth', refresh_token: 'new-r', access_token: 'new-a', expires_at: 99, scope: 'read,activity:read,activity:write' },
        });

        expect(prisma.account.updateMany).toHaveBeenCalledWith({
            where: { provider: 'strava', providerAccountId: '42' },
            data: { refresh_token: 'enc:new-r', access_token: 'enc:new-a', expires_at: 99, scope: 'read,activity:read,activity:write' },
        });
    });

    it('ignores non-Strava sign-ins', async () => {
        await authOptions.events!.signIn!({
            user: { id: 'u1' },
            account: { provider: 'google', providerAccountId: 'g', type: 'oauth', refresh_token: 'r' },
        });
        expect(prisma.account.updateMany).not.toHaveBeenCalled();
    });
});

describe('session callback (#117)', () => {
    it('exposes id, athleteId and isAdmin and records the user as seen', async () => {
        const session = await authOptions.callbacks!.session!({ session: { user: { name: 'x' } }, user: { id: 'u1', athleteId: '42', isAdmin: true } } as never);
        expect(session.user).toMatchObject({ id: 'u1', athleteId: '42', isAdmin: true });
        expect(touchUserLastSeen).toHaveBeenCalledWith('u1');
    });
});

describe('sign-in providers (#126)', () => {
    it('offers Strava as the only way to sign in, even when Google credentials are configured', () => {
        jest.isolateModules(() => {
            process.env.GOOGLE_CLIENT_ID = 'g';
            process.env.GOOGLE_CLIENT_SECRET = 'g';
            const { authOptions: fresh } = require('./auth');
            expect(fresh.providers.map((p: { id: string }) => p.id)).toEqual(['strava']);
            delete process.env.GOOGLE_CLIENT_ID;
            delete process.env.GOOGLE_CLIENT_SECRET;
        });
    });
});

describe('new-user alert (#133)', () => {
    const signIn = (isNewUser: boolean) => authOptions.events!.signIn!({
        user: { id: '42', athleteId: '42', name: 'New Rider' },
        account: { provider: 'strava', providerAccountId: '42', type: 'oauth' },
        isNewUser,
    } as never);

    it('messages the admin on Telegram the first time someone signs in', async () => {
        await signIn(true);
        expect(sendTelegramMessage).toHaveBeenCalledWith('StreetSweep: new user signed up: New Rider (https://www.strava.com/athletes/42)');
    });

    it('stays quiet for returning users', async () => {
        await signIn(false);
        expect(sendTelegramMessage).not.toHaveBeenCalled();
    });
});
