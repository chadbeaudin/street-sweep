import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import { decryptToken } from '@/lib/tokenCrypto';
import { NextResponse } from 'next/server';

// Bridges the new NextAuth session to the existing (separate, unchanged)
// Strava activity-sync flow (lib/strava.ts): a user who signed in with
// Strava already granted activity:read (see lib/auth.ts), so their linked
// Account row's refresh_token is directly usable as `stravaCredentials` on
// the client -- same shape/usage as the refreshToken the manual "Connect to
// Strava" flow has always produced, just sourced from the session instead of
// a separate OAuth popup.
export async function GET() {
    const session = await getServerSession(authOptions);
    const userId = (session?.user as any)?.id as string | undefined;
    if (!userId) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

    const account = await prisma.account.findFirst({
        where: { userId, provider: 'strava' },
    });
    if (!account?.refresh_token) {
        return NextResponse.json({ error: 'No linked Strava account' }, { status: 404 });
    }

    let refreshToken: string;
    try {
        refreshToken = decryptToken(account.refresh_token);
    } catch {
        return NextResponse.json({ error: 'Stored Strava token could not be decrypted' }, { status: 500 });
    }

    return NextResponse.json({ refreshToken });
}
