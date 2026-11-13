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

import { isAdminUser, summarizeApiMetrics, summarizeUsage, summarizeObservability, summarizeFailures, getAdminStats, MONTHLY_PREFIXES } from './adminStats';
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

const row = (name: string, count: number, sum = 0) => ({ name, count, sum });

describe('summarizeUsage (#117)', () => {
    it('breaks usage down by kind and ranks the busiest regions', () => {
        const usage = summarizeUsage([
            row('usage.route.point', 5), row('usage.route.area', 2), row('usage.route.point', 1),
            row('usage.export.gpx', 3), row('usage.import.fit', 1), row('usage.import.library', 2),
            row('usage.stats_open', 4), row('usage.strava_sync.incremental', 6),
            row('region.47,-118', 7), row('region.45,-123', 9), row('region.-34,151', 1),
        ]);
        expect(usage.routes).toEqual({ point: 6, area: 2 });
        expect(usage.exports).toEqual({ gpx: 3 });
        expect(usage.imports).toEqual({ fit: 1, library: 2 });
        expect(usage.statsOpens).toBe(4);
        expect(usage.stravaSyncs).toEqual({ incremental: 6 });
        expect(usage.regions).toEqual([{ lat: 45, lon: -123, count: 9 }, { lat: 47, lon: -118, count: 7 }, { lat: -34, lon: 151, count: 1 }]);
    });

    it('keeps only the top ten regions', () => {
        const rows = Array.from({ length: 12 }, (_, i) => row(`region.${i},0`, i + 1));
        expect(summarizeUsage(rows).regions.map(r => r.count)).toEqual([12, 11, 10, 9, 8, 7, 6, 5, 4, 3]);
    });
});

describe('summarizeObservability (#117)', () => {
    it('summarizes routing, services, caches, workers and rate limits', () => {
        const o = summarizeObservability([
            row('cpp.solve.ms', 4, 2000), row('cpp.solve.lat_250', 3), row('cpp.solve.lat_1000', 1),
            row('cpp.route_mi.5', 3), row('cpp.route_mi.inf', 1), row('cpp.too_large.area', 2),
            row('ext.overpass.requests', 10), row('ext.overpass.error', 2), row('ext.overpass.breaker', 1),
            row('ext.strava.requests', 30), row('ext.strava.rate_limited', 3),
            row('cache.osm.memory', 6), row('cache.osm.disk', 2), row('cache.osm.miss', 2),
            row('worker.ridden_roads.ms', 2, 90_000), row('worker.ridden_roads.lat_60000', 2), row('worker.ridden_roads.failed', 1),
            row('ratelimit.geocode', 5),
            row('api.POST /api/step.requests', 99),
        ]);
        expect(o.routing.solve).toEqual({ runs: 4, avgMs: 500, p50Ms: 250, p95Ms: 1000 });
        expect(o.routing.sizes).toEqual([
            { bound: '5', count: 3 }, { bound: '10', count: 0 }, { bound: '25', count: 0 }, { bound: '50', count: 0 }, { bound: 'inf', count: 1 },
        ]);
        expect(o.routing.tooLarge).toEqual({ area: 2 });
        expect(o.services).toEqual([
            { service: 'strava', requests: 30, errors: 0, rateLimited: 3, breaker: 0 },
            { service: 'overpass', requests: 10, errors: 2, rateLimited: 0, breaker: 1 },
        ]);
        expect(o.caches[0]).toEqual({ cache: 'osm', hits: { memory: 6, disk: 2 }, misses: 2, hitRate: 0.8 });
        expect(o.caches[1]).toEqual({ cache: 'graph', hits: {}, misses: 0, hitRate: null });
        expect(o.workers[0]).toEqual({ job: 'ridden_roads', runs: 2, avgMs: 45_000, p50Ms: 60_000, p95Ms: 60_000, failed: 1 });
        expect(o.workers[1]).toMatchObject({ job: 'athlete_sync', runs: 0, failed: 0 });
        expect(o.rateLimited).toEqual({ geocode: 5 });
    });
});

describe('summarizeFailures (#117)', () => {
    it('lists user-visible errors by 30-day count with their last-day count, and rolls up account health and lost work', () => {
        const f = summarizeFailures(
            [row('client_error.step', 2), row('memory.app.pct', 3, 150), row('memory.app.pct_50', 2), row('memory.app.pct_90', 1), row('memory.worker.pct', 1, 95), row('memory.worker.pct_over', 1)],
            [
                row('client_error.step', 5), row('client_error.generate', 9),
                row('account.strava_token_rejected', 4), row('account.deleted', 1),
                row('worker.athlete_sync.given_up', 2), row('worker.ridden_roads.tile_failed', 7),
                row('webhook.rejected', 3), row('webhook.ignored', 1),
            ],
        );
        expect(f.userErrors).toEqual([{ kind: 'generate', day: 0, month: 9 }, { kind: 'step', day: 2, month: 5 }]);
        expect(f.accountHealth).toEqual({ strava_token_rejected: 4, deleted: 1 });
        expect(f.lostWork).toEqual({ syncGivenUp: 2, syncNoCredentials: 0, enqueueFailed: 0, tilesFailed: 7, webhook: { rejected: 3, ignored: 1 } });
        expect(f.memory).toEqual([
            { process: 'app', samples: 3, avgPct: 50, peak: '90' },
            { process: 'worker', samples: 1, avgPct: 95, peak: 'over' },
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
        p.metricCounter.groupBy
            .mockResolvedValueOnce([{ name: 'api.GET /api/account.requests', _sum: { count: 9, sum: 0 } }, { name: 'ext.strava.requests', _sum: { count: 4, sum: 0 } }])
            .mockResolvedValueOnce([{ name: 'usage.route.point', _sum: { count: 2, sum: 0 } }]);

        const stats = await getAdminStats(now);

        expect(stats.users).toMatchObject({ total: 5, stravaLinked: 4, withHistory: 3 });
        expect(stats.queues.riddenRoads).toEqual({ queued: 2, failed: 1 });
        expect(stats.queues.stravaSync).toEqual({ pending: 1, retrying: 1, oldestAgeMs: 90_000 });
        expect(stats.api[0]).toMatchObject({ route: 'GET /api/account', requests: 9 });
        expect(p.user.count).toHaveBeenCalledWith({ where: { lastSeenAt: { gte: new Date(now - 24 * 60 * 60 * 1000) } } });
        expect(stats.observability.services).toEqual([{ service: 'strava', requests: 4, errors: 0, rateLimited: 0, breaker: 0 }]);
        expect(stats.usage.routes).toEqual({ point: 2 });
        expect(p.metricCounter.groupBy.mock.calls[0][0].where).toEqual({ bucket: { gte: new Date(now - 24 * 60 * 60 * 1000) } });
        const monthly = p.metricCounter.groupBy.mock.calls[1][0].where;
        expect(monthly.bucket).toEqual({ gte: new Date(now - 30 * 24 * 60 * 60 * 1000) });
        expect(monthly.OR).toEqual(expect.arrayContaining([
            ...MONTHLY_PREFIXES.map(p => ({ name: { startsWith: p } })),
            { name: { in: expect.arrayContaining(['worker.athlete_sync.given_up', 'worker.ridden_roads.tile_failed']) } },
        ]));
    });
});
