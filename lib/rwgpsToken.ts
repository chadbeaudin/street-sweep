import { getServerSession } from 'next-auth';
import { authOptions } from './auth';
import { prisma } from './prisma';
import { encryptToken, decryptToken } from './tokenCrypto';

// The route-library access token lives encrypted on the signed-in user's
// Account rows, like the Strava tokens, so it never reaches the client (#194).
// providerAccountId is the user id: one connection per StreetSweep user.
const PROVIDER = 'rwgps';

export async function sessionUserId(): Promise<string | null> {
    const session = await getServerSession(authOptions);
    return (session?.user as { id?: string } | undefined)?.id ?? null;
}

export async function saveRwgpsToken(userId: string, accessToken: string): Promise<void> {
    const access_token = encryptToken(accessToken);
    await prisma.account.upsert({
        where: { provider_providerAccountId: { provider: PROVIDER, providerAccountId: userId } },
        create: { userId, type: 'oauth', provider: PROVIDER, providerAccountId: userId, access_token },
        update: { access_token },
    });
}

export async function getRwgpsToken(userId: string): Promise<string | null> {
    const account = await prisma.account.findFirst({ where: { userId, provider: PROVIDER } });
    if (!account?.access_token) return null;
    try {
        return decryptToken(account.access_token);
    } catch {
        return null;
    }
}
