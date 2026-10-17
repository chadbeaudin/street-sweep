const executeRawUnsafe = jest.fn();
const userUpdate = jest.fn();
jest.mock('./prisma', () => ({ prisma: { $executeRawUnsafe: (...a: unknown[]) => executeRawUnsafe(...a), user: { update: (...a: unknown[]) => userUpdate(...a) } } }));

import { incrementMetric, recordLatency, flushMetrics, withApiMetrics, touchUserLastSeen, hourBucket } from './metrics';

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
