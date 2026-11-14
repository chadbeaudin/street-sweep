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
export async function getSessionStravaCredentials(): Promise<{ refreshToken: string; athleteId: string } | null> {
    const session = await getServerSession(authOptions);
    const userId = (session?.user as any)?.id as string | undefined;
    if (!userId) return null;

    const account = await prisma.account.findFirst({ where: { userId, provider: 'strava' } });
    if (!account?.refresh_token) return null;

    try {
        // The Strava account id is the athlete id, so lookups never need Strava to be up (#165).
        return { refreshToken: decryptToken(account.refresh_token), athleteId: account.providerAccountId };
    } catch {
        return null;
    }
}

// The one place a Strava-backed API route gets credentials (#126): only the
// signed-in user's own token. Credentials sent in a request body are never
// trusted, so an anonymous caller never falls through to the server's STRAVA_*
// env account.
export async function resolveRequestStravaCredentials(): Promise<{ refreshToken: string; athleteId: string } | null> {
    return getSessionStravaCredentials();
}
