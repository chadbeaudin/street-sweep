const executeRawUnsafe = jest.fn();
const userUpdate = jest.fn();
jest.mock('./prisma', () => ({ prisma: { $executeRawUnsafe: (...a: unknown[]) => executeRawUnsafe(...a), user: { update: (...a: unknown[]) => userUpdate(...a) } } }));

import { incrementMetric, recordLatency, flushMetrics, withApiMetrics, touchUserLastSeen, hourBucket, outcomeForStatus, outcomeForResponse, recordExternalCall, recordExternalBreaker, recordCacheLookup, routeKind, regionCell, recordGeneratedRoute, recordJobRun, recordHeapSample, processLabel } from './metrics';

const HOUR = 60 * 60 * 1000;
const T = Date.UTC(2026, 9, 16, 10, 30);
const flushedRows = () => {
    const [, ...params] = executeRawUnsafe.mock.calls[executeRawUnsafe.mock.calls.length - 1];
    const rows: { bucket: Date; name: string; count: number; sum: number }[] = [];
    for (let i = 0; i < params.length; i += 4) rows.push({ bucket: params[i], name: params[i + 1], count: params[i + 2], sum: params[i + 3] });
    return rows;
};

beforeEach(async () => {
    executeRawUnsafe.mockResolvedValue(0);
    userUpdate.mockResolvedValue({});
    await flushMetrics();
    executeRawUnsafe.mockClear();
});

describe('metrics (#117)', () => {
    it('aggregates counters per hour in memory and flushes them in one upsert', async () => {
        incrementMetric('a', 1, 0, T);
        incrementMetric('a', 2, 5, T + 60_000);
        incrementMetric('a', 1, 0, T + HOUR);
        await flushMetrics();
        expect(executeRawUnsafe).toHaveBeenCalledTimes(1);
        expect(executeRawUnsafe.mock.calls[0][0]).toContain('ON CONFLICT (bucket, name) DO UPDATE');
        expect(flushedRows()).toEqual([
            { bucket: hourBucket(T), name: 'a', count: 3, sum: 5 },
            { bucket: hourBucket(T + HOUR), name: 'a', count: 1, sum: 0 },
        ]);
    });

    it('does nothing when there is nothing to flush', async () => {
        await flushMetrics();
        expect(executeRawUnsafe).not.toHaveBeenCalled();
    });

    it('keeps counters for the next flush when the database write fails', async () => {
        executeRawUnsafe.mockRejectedValueOnce(new Error('db down'));
        incrementMetric('b', 2, 0, T);
        await flushMetrics();
        incrementMetric('b', 1, 0, T);
        await flushMetrics();
        expect(flushedRows()).toEqual([{ bucket: hourBucket(T), name: 'b', count: 3, sum: 0 }]);
    });

    it('buckets latency into the histogram and keeps a millisecond total', async () => {
        recordLatency('r', 80, T);
        recordLatency('r', 700, T);
        recordLatency('r', 90_000, T);
        await flushMetrics();
        const byName = Object.fromEntries(flushedRows().map(r => [r.name, r]));
        expect(byName['r.lat_100'].count).toBe(1);
        expect(byName['r.lat_1000'].count).toBe(1);
        expect(byName['r.lat_inf'].count).toBe(1);
        expect(byName['r.ms']).toMatchObject({ count: 3, sum: 90_780 });
    });

    it('records requests, error classes and latency for a wrapped handler', async () => {
        const ok = withApiMetrics('POST', '/api/x', async () => ({ status: 200 }));
        const bad = withApiMetrics('POST', '/api/x', async () => ({ status: 404 }));
        const boom = withApiMetrics('POST', '/api/x', async () => { throw new Error('boom'); });
        await ok();
        await bad();
        await expect(boom()).rejects.toThrow('boom');
        await flushMetrics();
        const byName = Object.fromEntries(flushedRows().map(r => [r.name, r.count]));
        expect(byName['api.POST /api/x.requests']).toBe(3);
        expect(byName['api.POST /api/x.4xx']).toBe(1);
        expect(byName['api.POST /api/x.5xx']).toBe(1);
        expect(byName['api.POST /api/x.ms']).toBe(3);
    });

    it('passes the handler arguments and response through untouched', async () => {
        const res = { status: 201, body: 'x' };
        const wrapped = withApiMetrics('GET', '/api/y', async (a: number, b: string) => ({ ...res, echo: `${a}${b}` }));
        expect(await wrapped(1, 'z')).toEqual({ ...res, echo: '1z' });
    });

    it('updates lastSeenAt at most once per 15 minutes per user', async () => {
        touchUserLastSeen('u1', T);
        touchUserLastSeen('u1', T + 60_000);
        touchUserLastSeen('u2', T + 60_000);
        touchUserLastSeen('u1', T + 16 * 60_000);
        await new Promise(r => setImmediate(r));
        expect(userUpdate.mock.calls.map(c => c[0].where.id)).toEqual(['u1', 'u2', 'u1']);
    });
});

describe('usage and observability counters (#117)', () => {
    const flushedCounts = async () => {
        await flushMetrics();
        return Object.fromEntries(flushedRows().map(r => [r.name, r.count]));
    };

    it('classifies responses: 429/509 are rate limits, 5xx errors; any non-2xx fails where 4xx is not routine', () => {
        expect(outcomeForStatus(200)).toBe('ok');
        expect(outcomeForStatus(404)).toBe('ok');
        expect(outcomeForStatus(429)).toBe('rate_limited');
        expect(outcomeForStatus(509)).toBe('rate_limited');
        expect(outcomeForStatus(504)).toBe('error');
        expect(outcomeForResponse({ ok: true, status: 200 })).toBe('ok');
        expect(outcomeForResponse({ ok: false, status: 400 })).toBe('error');
        expect(outcomeForResponse({ ok: false, status: 429 })).toBe('rate_limited');
    });

    it('counts every external call, and failures by class', async () => {
        recordExternalCall('overpass', 'ok');
        recordExternalCall('overpass', 'error');
        recordExternalCall('overpass', 'rate_limited');
        recordExternalBreaker('overpass');
        expect(await flushedCounts()).toEqual({ 'ext.overpass.requests': 3, 'ext.overpass.error': 1, 'ext.overpass.rate_limited': 1, 'ext.overpass.breaker': 1 });
    });

    it('counts cache lookups by the tier that answered', async () => {
        recordCacheLookup('osm', 'memory');
        recordCacheLookup('osm', 'miss');
        expect(await flushedCounts()).toEqual({ 'cache.osm.memory': 1, 'cache.osm.miss': 1 });
    });

    it('names a route by what was drawn', () => {
        expect(routeKind(3, 0, 0)).toBe('point');
        expect(routeKind(0, 1, 0)).toBe('area');
        expect(routeKind(0, 0, 2)).toBe('lasso');
        expect(routeKind(2, 1, 0)).toBe('mixed');
        expect(routeKind(0, 1, 1)).toBe('mixed');
    });

    it('reduces a location to its one-degree cell', () => {
        expect(regionCell(47.66, -117.42)).toBe('47,-118');
        expect(regionCell(-33.9, 151.2)).toBe('-34,151');
    });

    it('records a generated route\'s kind, region, solve time and length bucket', async () => {
        recordGeneratedRoute('area', 47.66, -117.42, 12.3, 850);
        recordGeneratedRoute('point', 47.66, -117.42, 64, 90);
        const counts = await flushedCounts();
        expect(counts).toMatchObject({
            'usage.route.area': 1, 'usage.route.point': 1, 'region.47,-118': 2,
            'cpp.solve.ms': 2, 'cpp.solve.lat_1000': 1, 'cpp.solve.lat_100': 1,
            'cpp.route_mi.25': 1, 'cpp.route_mi.inf': 1,
        });
    });

    it('times successful job runs and counts failed ones', async () => {
        recordJobRun('athlete_sync', 4000, true);
        recordJobRun('athlete_sync', 100, false);
        const counts = await flushedCounts();
        expect(counts).toMatchObject({ 'worker.athlete_sync.ms': 1, 'worker.athlete_sync.lat_5000': 1, 'worker.athlete_sync.failed': 1 });
    });
});

describe('process memory (#117)', () => {
    it('samples heap use per process with an average and a bucket', async () => {
        recordHeapSample('app', 40);
        recordHeapSample('app', 95);
        await flushMetrics();
        const rows = Object.fromEntries(flushedRows().map(r => [r.name, r]));
        expect(rows['memory.app.pct']).toMatchObject({ count: 2, sum: 135 });
        expect(rows['memory.app.pct_50'].count).toBe(1);
        expect(rows['memory.app.pct_over'].count).toBe(1);
    });

    it('labels the Fly app, the production worker and local dev apart', () => {
        expect(processLabel({ FLY_APP_NAME: 'streetsweep', NODE_ENV: 'production' })).toBe('app');
        expect(processLabel({ NODE_ENV: 'production' })).toBe('worker');
        expect(processLabel({ NODE_ENV: 'development' })).toBe('dev');
    });
});
