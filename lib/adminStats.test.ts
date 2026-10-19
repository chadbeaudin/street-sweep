jest.mock('./prisma', () => {
    const count = () => ({ count: jest.fn() });
    return {
        prisma: {
            user: { ...count(), findUnique: jest.fn() }, account: count(), stravaActivityCache: count(), exportedRoute: count(),
            riddenRoadsJob: { groupBy: jest.fn() },
            stravaSyncEvent: { count: jest.fn(), findFirst: jest.fn() },
            metricCounter: { groupBy: jest.fn() },
        },
    };
});

import { isAdminUser, summarizeApiMetrics, getAdminStats } from './adminStats';
import { prisma } from './prisma';

const p = prisma as any;

describe('isAdminUser (#117)', () => {
    it('allows only users flagged isAdmin in the database', async () => {
        p.user.findUnique.mockResolvedValueOnce({ isAdmin: true });
        expect(await isAdminUser('u1')).toBe(true);
        expect(p.user.findUnique).toHaveBeenCalledWith({ where: { id: 'u1' }, select: { isAdmin: true } });
        p.user.findUnique.mockResolvedValueOnce({ isAdmin: false });
        expect(await isAdminUser('u2')).toBe(false);
        p.user.findUnique.mockResolvedValueOnce(null);
        expect(await isAdminUser('gone')).toBe(false);
    });

    it('allows nobody without a signed-in user, without querying', async () => {
        expect(await isAdminUser(undefined)).toBe(false);
        expect(p.user.findUnique).not.toHaveBeenCalled();
    });
});

describe('summarizeApiMetrics (#117)', () => {
    it('rolls counters up per route with error counts, average and histogram percentiles', () => {
        const rows = [
            { name: 'api.POST /api/step.requests', count: 20, sum: 0 },
            { name: 'api.POST /api/step.4xx', count: 2, sum: 0 },
            { name: 'api.POST /api/step.ms', count: 20, sum: 4000 },
            { name: 'api.POST /api/step.lat_100', count: 10, sum: 0 },
            { name: 'api.POST /api/step.lat_250', count: 8, sum: 0 },
            { name: 'api.POST /api/step.lat_5000', count: 2, sum: 0 },
            { name: 'api.POST /api/generate.requests', count: 2, sum: 0 },
            { name: 'api.POST /api/generate.5xx', count: 1, sum: 0 },
            { name: 'api.POST /api/generate.ms', count: 2, sum: 200_000 },
            { name: 'api.POST /api/generate.lat_inf', count: 2, sum: 0 },
            { name: 'overpass.error', count: 4, sum: 0 },
        ];
        expect(summarizeApiMetrics(rows)).toEqual([
            { route: 'POST /api/step', requests: 20, clientErrors: 2, serverErrors: 0, avgMs: 200, p50Ms: 100, p95Ms: 5000 },
            { route: 'POST /api/generate', requests: 2, clientErrors: 0, serverErrors: 1, avgMs: 100_000, p50Ms: null, p95Ms: null },
        ]);
    });
});

describe('getAdminStats (#117)', () => {
    it('assembles user, queue and API figures', async () => {
        const now = Date.UTC(2026, 9, 16);
        p.user.count.mockResolvedValue(5);
        p.account.count.mockResolvedValue(4);
        p.stravaActivityCache.count.mockResolvedValue(3);
        p.exportedRoute.count.mockResolvedValue(7);
        p.riddenRoadsJob.groupBy.mockResolvedValue([{ status: 'queued', _count: { _all: 2 } }, { status: 'failed', _count: { _all: 1 } }]);
        p.stravaSyncEvent.count.mockResolvedValue(1);
        p.stravaSyncEvent.findFirst.mockResolvedValue({ createdAt: new Date(now - 90_000) });
        p.metricCounter.groupBy.mockResolvedValue([{ name: 'api.GET /api/account.requests', _sum: { count: 9, sum: 0 } }]);

        const stats = await getAdminStats(now);

        expect(stats.users).toMatchObject({ total: 5, stravaLinked: 4, withHistory: 3 });
        expect(stats.queues.riddenRoads).toEqual({ queued: 2, failed: 1 });
        expect(stats.queues.stravaSync).toEqual({ pending: 1, retrying: 1, oldestAgeMs: 90_000 });
        expect(stats.api[0]).toMatchObject({ route: 'GET /api/account', requests: 9 });
        expect(p.user.count).toHaveBeenCalledWith({ where: { lastSeenAt: { gte: new Date(now - 24 * 60 * 60 * 1000) } } });
        expect(p.metricCounter.groupBy.mock.calls[0][0].where).toEqual({ bucket: { gte: new Date(now - 24 * 60 * 60 * 1000) }, name: { startsWith: 'api.' } });
    });
});
