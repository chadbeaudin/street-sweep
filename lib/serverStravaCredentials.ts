import { getServerSession } from 'next-auth';
import { authOptions } from './auth';
import { prisma } from './prisma';
import { decryptToken } from './tokenCrypto';

// Resolves the signed-in user's Strava refresh_token server-side only --
// never sent to or stored on the client (see app/api/auth/strava-credentials
// for the endpoint this replaced, and the security review that flagged it).
// clientId/clientSecret aren't needed here: they fall back to the shared
// STRAVA_CLIENT_ID/SECRET app env vars in lib/strava.ts, the same app this
// session's Strava sign-in itself used (lib/auth.ts).
export async function getSessionStravaCredentials(): Promise<{ refreshToken: string } | null> {
    const session = await getServerSession(authOptions);
    const userId = (session?.user as any)?.id as string | undefined;
    if (!userId) return null;

    const account = await prisma.account.findFirst({ where: { userId, provider: 'strava' } });
    if (!account?.refresh_token) return null;

    try {
        return { refreshToken: decryptToken(account.refresh_token) };
    } catch {
        return null;
    }
}
