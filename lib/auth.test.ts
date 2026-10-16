jest.mock('./prisma', () => ({ prisma: { account: { updateMany: jest.fn() } } }));
jest.mock('@auth/prisma-adapter', () => ({ PrismaAdapter: () => ({}) }));
jest.mock('./tokenCrypto', () => ({ encryptToken: (t: string) => `enc:${t}` }));

process.env.STRAVA_CLIENT_ID = 'client';
process.env.STRAVA_CLIENT_SECRET = 'secret';

import { authOptions } from './auth';
import { prisma } from './prisma';

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
