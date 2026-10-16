jest.mock('./prisma', () => ({
    prisma: {
        stravaSyncEvent: { groupBy: jest.fn(), findMany: jest.fn(), deleteMany: jest.fn(), updateMany: jest.fn() },
        stravaActivityCache: { findUnique: jest.fn(), update: jest.fn(), findMany: jest.fn(), deleteMany: jest.fn() },
        stravaActivityDetail: { upsert: jest.fn(), deleteMany: jest.fn() },
        stravaActivityStream: { deleteMany: jest.fn() },
        statsCache: { findMany: jest.fn(), deleteMany: jest.fn() },
        riddenRoadsTile: { findMany: jest.fn(), deleteMany: jest.fn() },
        riddenRoadsJob: { deleteMany: jest.fn() },
        ftpReadingCache: { deleteMany: jest.fn() },
        account: { findFirst: jest.fn(), findMany: jest.fn(), updateMany: jest.fn() },
        $transaction: jest.fn((ops: unknown[]) => Promise.all(ops)),
    },
}));
jest.mock('./strava', () => ({
    fetchStravaActivity: jest.fn(),
    getStravaAccessToken: jest.fn(),
    resolveAthleteId: jest.fn(),
    syncActivities: jest.fn(),
}));
jest.mock('./statsCompute', () => ({
    recomputeStats: jest.fn(),
    statsCacheKey: (id: string, mode: string) => mode === 'running' ? `${id}__running` : id,
}));
jest.mock('./athleteSyncQueue', () => ({ enqueueAthleteSync: jest.fn() }));
jest.mock('./tokenCrypto', () => ({ decryptToken: (v: string) => `dec:${v}`, encryptToken: (v: string) => v }));
jest.mock('./riddenRoadsRefresh', () => ({
    ...jest.requireActual('./riddenRoadsRefresh'),
    refreshRiddenRoadsInBackground: jest.fn(),
    decryptJobCreds: (v: string) => JSON.parse(v),
}));

import polyline from '@mapbox/polyline';
import { tickAthleteSyncWorker, enqueueDueResync, DEBOUNCE_MS } from './athleteSyncWorker';
import { prisma } from './prisma';
import { fetchStravaActivity, getStravaAccessToken, syncActivities } from './strava';
import { recomputeStats } from './statsCompute';
import { enqueueAthleteSync } from './athleteSyncQueue';
import { refreshRiddenRoadsInBackground, tilesForBbox } from './riddenRoadsRefresh';

const p = prisma as any;
const TRACK = polyline.encode([[47.65, -117.42], [47.66, -117.43]]);
const ride = (id: number, start = '2026-10-01T00:00:00Z', type = 'Ride') => ({ id, name: `ride ${id}`, map: { summary_polyline: TRACK }, start_date: start, type });
const event = (overrides: Record<string, unknown>) => ({ id: 1, athleteId: '42', aspect: 'create', activityId: null, mode: null, credsEncrypted: null, attempts: 0, availableAt: new Date(0), createdAt: new Date(0), ...overrides });
let clock = 1_000_000_000_000;
const tick = () => tickAthleteSyncWorker((clock += 10 * 60 * 1000));

function queue(...events: ReturnType<typeof event>[]) {
    p.stravaSyncEvent.groupBy.mockResolvedValue(events.length ? [{ athleteId: '42' }] : []);
    p.stravaSyncEvent.findMany.mockResolvedValue(events);
    p.stravaSyncEvent.updateMany.mockResolvedValue({ count: events.length });
}

beforeEach(() => {
    p.$transaction.mockImplementation((ops: unknown[]) => Promise.all(ops));
    p.account.findFirst.mockResolvedValue({ refresh_token: 'enc' });
    p.account.findMany.mockResolvedValue([]);
    p.statsCache.findMany.mockResolvedValue([]);
    p.riddenRoadsTile.findMany.mockResolvedValue([]);
    (getStravaAccessToken as jest.Mock).mockResolvedValue('token');
});

describe('tickAthleteSyncWorker (#118)', () => {
    it('only claims athletes whose events have been quiet for the debounce window', async () => {
        queue();
        const now = clock += 10 * 60 * 1000;
        expect(await tickAthleteSyncWorker(now)).toEqual({ processed: false });
        const args = p.stravaSyncEvent.groupBy.mock.calls[0][0];
        expect(args.having.createdAt._max.lte).toEqual(new Date(now - DEBOUNCE_MS));
    });

    it('skips events another tick has already claimed, so a long run is never processed twice', async () => {
        queue(event({ aspect: 'create', activityId: '2' }));
        p.stravaSyncEvent.updateMany.mockResolvedValue({ count: 0 });
        expect(await tick()).toEqual({ processed: false });
        expect(getStravaAccessToken).not.toHaveBeenCalled();
        expect(p.stravaSyncEvent.deleteMany).not.toHaveBeenCalled();
    });

    it('only considers unclaimed events or claims abandoned for 30 minutes', async () => {
        queue();
        const now = clock += 10 * 60 * 1000;
        await tickAthleteSyncWorker(now);
        expect(p.stravaSyncEvent.groupBy.mock.calls[0][0].where.OR).toEqual([{ claimedAt: null }, { claimedAt: { lt: new Date(now - 30 * 60 * 1000) } }]);
    });

    it('applies a new ride: adds it to the cached list, stores its full track, recomputes stats and rematches its cached tiles', async () => {
        const existingTile = tilesForBbox({ south: 47.65, north: 47.65, west: -117.42, east: -117.42 })[0];
        queue(event({ id: 7, aspect: 'create', activityId: '2' }));
        p.stravaActivityCache.findUnique.mockResolvedValue({ athleteId: '42', activities: [ride(1, '2026-09-01T00:00:00Z')] });
        (fetchStravaActivity as jest.Mock).mockResolvedValue({ activity: ride(2), fullPolyline: 'full' });
        p.riddenRoadsTile.findMany.mockResolvedValue([{ tile: existingTile }]);

        expect(await tick()).toEqual({ processed: true, athleteId: '42' });

        expect(fetchStravaActivity).toHaveBeenCalledWith('token', '2');
        const saved = p.stravaActivityCache.update.mock.calls[0][0].data.activities;
        expect(saved.map((a: { id: number }) => a.id)).toEqual([2, 1]);
        expect(p.stravaActivityDetail.upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { activityId: '2' } }));
        expect(recomputeStats).toHaveBeenCalledWith('42', { refreshToken: 'dec:enc' }, 'cycling');
        expect(refreshRiddenRoadsInBackground).toHaveBeenCalledWith('42', { refreshToken: 'dec:enc' }, 'cycling', [existingTile]);
        expect(p.stravaSyncEvent.deleteMany).toHaveBeenCalledWith({ where: { id: { in: [7] } } });
    });

    it('removes a deleted ride without asking Strava, and drops its stored tracks', async () => {
        queue(event({ aspect: 'create', activityId: '2' }), event({ id: 2, aspect: 'delete', activityId: '2' }));
        p.stravaActivityCache.findUnique.mockResolvedValue({ athleteId: '42', activities: [ride(1), ride(2)] });

        await tick();

        expect(fetchStravaActivity).not.toHaveBeenCalled();
        expect(p.stravaActivityCache.update.mock.calls[0][0].data.activities.map((a: { id: number }) => a.id)).toEqual([1]);
        expect(p.stravaActivityDetail.deleteMany).toHaveBeenCalledWith({ where: { activityId: '2' } });
        expect(p.stravaActivityStream.deleteMany).toHaveBeenCalledWith({ where: { activityId: '2' } });
    });

    it('also recomputes running stats when the athlete has them', async () => {
        queue(event({ aspect: 'update', activityId: '1' }));
        p.stravaActivityCache.findUnique.mockResolvedValue({ athleteId: '42', activities: [ride(1)] });
        (fetchStravaActivity as jest.Mock).mockResolvedValue({ activity: ride(1) });
        p.statsCache.findMany.mockResolvedValue([{ athleteId: '42' }, { athleteId: '42__running' }]);

        await tick();

        expect((recomputeStats as jest.Mock).mock.calls.map(c => c[2]).sort()).toEqual(['cycling', 'running']);
    });

    it('recomputes just the requested mode, using the creds queued with the request', async () => {
        queue(event({ aspect: 'recompute', mode: 'running', credsEncrypted: JSON.stringify({ refreshToken: 'queued' }) }));

        await tick();

        expect(p.account.findFirst).not.toHaveBeenCalled();
        expect(recomputeStats).toHaveBeenCalledTimes(1);
        expect(recomputeStats).toHaveBeenCalledWith('42', { refreshToken: 'queued' }, 'running');
    });

    it('runs a catch-up resync and recomputes only if the list changed', async () => {
        queue(event({ aspect: 'resync' }));
        p.stravaActivityCache.findUnique.mockResolvedValue({ athleteId: '42', activities: [], fullSyncedAt: new Date() });
        (syncActivities as jest.Mock).mockResolvedValue({ activities: [], changed: false });
        await tick();
        expect((syncActivities as jest.Mock).mock.calls[0][3]).toEqual({ full: false });
        expect(recomputeStats).not.toHaveBeenCalled();

        queue(event({ aspect: 'resync' }));
        p.stravaActivityCache.findUnique.mockResolvedValue({ athleteId: '42', activities: [], fullSyncedAt: null });
        (syncActivities as jest.Mock).mockResolvedValue({ activities: [], changed: true });
        await tick();
        expect((syncActivities as jest.Mock).mock.calls[1][3]).toEqual({ full: true });
        expect(recomputeStats).toHaveBeenCalled();
    });

    it('purges everything held for an athlete who revoked access, without calling Strava', async () => {
        queue(event({ aspect: 'deauthorize' }));

        await tick();

        expect(getStravaAccessToken).not.toHaveBeenCalled();
        expect(p.stravaActivityCache.deleteMany).toHaveBeenCalledWith({ where: { athleteId: '42' } });
        expect(p.statsCache.deleteMany).toHaveBeenCalledWith({ where: { athleteId: { in: ['42', '42__running'] } } });
        expect(p.account.updateMany).toHaveBeenCalledWith({ where: { provider: 'strava', providerAccountId: '42' }, data: { refresh_token: null, access_token: null } });
        expect(p.stravaSyncEvent.deleteMany).toHaveBeenCalled();
    });

    it('drops events for an athlete it has no credentials for', async () => {
        queue(event({ aspect: 'create', activityId: '2' }));
        p.account.findFirst.mockResolvedValue(null);

        await tick();

        expect(getStravaAccessToken).not.toHaveBeenCalled();
        expect(p.stravaSyncEvent.deleteMany).toHaveBeenCalled();
    });

    it('backs off on failure and gives up after repeated attempts', async () => {
        queue(event({ aspect: 'create', activityId: '2', attempts: 1 }));
        p.stravaActivityCache.findUnique.mockResolvedValue({ athleteId: '42', activities: [] });
        (fetchStravaActivity as jest.Mock).mockRejectedValue(new Error('429'));
        await tick();
        expect(p.stravaSyncEvent.updateMany).toHaveBeenLastCalledWith({ where: { id: { in: [1] } }, data: { attempts: 2, claimedAt: null, availableAt: new Date(clock + 2 * 5 * 60 * 1000) } });
        expect(p.stravaSyncEvent.deleteMany).not.toHaveBeenCalled();

        queue(event({ aspect: 'create', activityId: '2', attempts: 4 }));
        await tick();
        expect(p.stravaSyncEvent.deleteMany).toHaveBeenCalled();
    });
});

describe('enqueueDueResync (#118)', () => {
    const DAY = 24 * 60 * 60 * 1000;

    it('queues a resync for a signed-in athlete not synced in a day, skipping ones with work pending', async () => {
        const now = clock += 10 * 60 * 1000;
        p.account.findMany.mockResolvedValue([{ providerAccountId: '1' }, { providerAccountId: '2' }, { providerAccountId: '3' }]);
        p.stravaActivityCache.findMany.mockResolvedValue([
            { athleteId: '1', syncedAt: new Date(now - 2 * DAY), fullSyncedAt: new Date(now) },
            { athleteId: '2', syncedAt: new Date(now - 2 * DAY), fullSyncedAt: new Date(now) },
            { athleteId: '3', syncedAt: new Date(now), fullSyncedAt: new Date(now) },
        ]);
        p.stravaSyncEvent.findMany.mockResolvedValue([{ athleteId: '1' }]);

        expect(await enqueueDueResync(now)).toBe('2');
        expect(enqueueAthleteSync).toHaveBeenCalledWith('2', 'resync');
    });

    it('queues one when the weekly full pull is due even if recently synced', async () => {
        const now = clock += 10 * 60 * 1000;
        p.account.findMany.mockResolvedValue([{ providerAccountId: '3' }]);
        p.stravaActivityCache.findMany.mockResolvedValue([{ athleteId: '3', syncedAt: new Date(now), fullSyncedAt: new Date(now - 8 * DAY) }]);
        p.stravaSyncEvent.findMany.mockResolvedValue([]);
        expect(await enqueueDueResync(now)).toBe('3');
    });

    it('checks at most once a minute', async () => {
        const now = clock += 10 * 60 * 1000;
        p.account.findMany.mockResolvedValue([]);
        await enqueueDueResync(now);
        await enqueueDueResync(now + 1000);
        expect(p.account.findMany).toHaveBeenCalledTimes(1);
    });
});
