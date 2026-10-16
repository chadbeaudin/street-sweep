import { prisma } from './prisma';
import { decryptToken } from './tokenCrypto';
import { getStravaAccessToken, resolveAthleteId } from './strava';
import { riddenRoadsCacheKey } from './riddenRoadsRefresh';

// Revokes this app's Strava access for the athlete. Must only ever run with the
// user's own refresh token: getStravaAccessToken falls back to the server's
// STRAVA_REFRESH_TOKEN when none is given, which would deauthorize the shared one.
async function revokeStravaAccess(encryptedRefreshToken: string): Promise<void> {
    const refreshToken = decryptToken(encryptedRefreshToken);
    if (!refreshToken) return;
    const accessToken = await getStravaAccessToken({ refreshToken });
    await fetch('https://www.strava.com/oauth/deauthorize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ access_token: accessToken }),
    });
}

// Strava deauthorization revokes every token this app holds for the athlete, including
// the server's shared STRAVA_REFRESH_TOKEN when it belongs to the same athlete -- which
// would break the default Strava connection for everyone. Skip revoking in that case,
// and also when it can't be ruled out.
async function isSharedServerAthlete(athleteId: string | null): Promise<boolean> {
    if (!process.env.STRAVA_REFRESH_TOKEN || !athleteId) return false;
    try {
        return (await resolveAthleteId()) === athleteId;
    } catch {
        return true;
    }
}

export async function deleteAccount(userId: string): Promise<void> {
    const user = await prisma.user.findUnique({ where: { id: userId }, include: { accounts: true } });
    if (!user) return;

    const strava = user.accounts.find(a => a.provider === 'strava');
    if (strava?.refresh_token && !(await isSharedServerAthlete(user.athleteId))) {
        // Best effort: the user's data is deleted either way, and they can still revoke from Strava's settings.
        await revokeStravaAccess(strava.refresh_token).catch(e => console.warn(`[AccountDeletion] Strava deauthorize failed: ${e.message}`));
    }

    const athleteId = user.athleteId;
    const athleteKeys = athleteId ? [riddenRoadsCacheKey(athleteId, 'cycling'), riddenRoadsCacheKey(athleteId, 'running')] : [];

    await prisma.$transaction([
        ...(athleteId ? [
            prisma.riddenRoadsTile.deleteMany({ where: { athleteKey: { in: athleteKeys } } }),
            prisma.riddenRoadsJob.deleteMany({ where: { athleteId } }),
            prisma.statsCache.deleteMany({ where: { athleteId: { in: athleteKeys } } }),
            prisma.stravaActivityCache.deleteMany({ where: { athleteId } }),
            prisma.stravaActivityDetail.deleteMany({ where: { athleteId } }),
            prisma.stravaActivityStream.deleteMany({ where: { athleteId } }),
            prisma.ftpReadingCache.deleteMany({ where: { athleteId } }),
            prisma.stravaSyncEvent.deleteMany({ where: { athleteId } }),
        ] : []),
        // Cascades to Account and Session.
        prisma.user.delete({ where: { id: userId } }),
    ]);
}
