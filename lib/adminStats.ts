import { prisma } from './prisma';
import { HEAP_PCT_BUCKETS, LATENCY_BUCKETS_MS, ROUTE_MILES_BUCKETS } from './metrics';

const DAY_MS = 24 * 60 * 60 * 1000;

export async function isAdminUser(userId: string | null | undefined): Promise<boolean> {
    if (!userId) return false;
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { isAdmin: true } });
    return user?.isAdmin ?? false;
}

export interface RouteHealth {
    route: string;
    requests: number;
    clientErrors: number;
    serverErrors: number;
    avgMs: number;
    p50Ms: number | null; // null: slower than the histogram's last bound
    p95Ms: number | null;
}

// Upper bound of the histogram bucket the given percentile falls in.
function percentile(histogram: Map<string, number>, total: number, p: number): number | null {
    const target = Math.ceil(total * p);
    let seen = 0;
    for (const bound of LATENCY_BUCKETS_MS) {
        seen += histogram.get(String(bound)) ?? 0;
        if (seen >= target) return bound;
    }
    return null;
}

export function summarizeApiMetrics(rows: { name: string; count: number; sum: number }[]): RouteHealth[] {
    const byRoute = new Map<string, { requests: number; clientErrors: number; serverErrors: number; totalMs: number; timed: number; histogram: Map<string, number> }>();
    for (const { name, count, sum } of rows) {
        const match = /^api\.(.+)\.(requests|4xx|5xx|ms|lat_(\w+))$/.exec(name);
        if (!match) continue;
        const [, route, field, bound] = match;
        const r = byRoute.get(route) ?? { requests: 0, clientErrors: 0, serverErrors: 0, totalMs: 0, timed: 0, histogram: new Map() };
        if (field === 'requests') r.requests += count;
        else if (field === '4xx') r.clientErrors += count;
        else if (field === '5xx') r.serverErrors += count;
        else if (field === 'ms') { r.totalMs += sum; r.timed += count; }
        else r.histogram.set(bound, (r.histogram.get(bound) ?? 0) + count);
        byRoute.set(route, r);
    }
    return [...byRoute.entries()]
        .map(([route, r]) => ({
            route,
            requests: r.requests,
            clientErrors: r.clientErrors,
            serverErrors: r.serverErrors,
            avgMs: r.timed > 0 ? r.totalMs / r.timed : 0,
            p50Ms: percentile(r.histogram, r.timed, 0.5),
            p95Ms: percentile(r.histogram, r.timed, 0.95),
        }))
        .sort((a, b) => b.requests - a.requests);
}

type CounterRow = { name: string; count: number; sum: number };
type Counters = Map<string, { count: number; sum: number }>;

function toCounters(rows: CounterRow[]): Counters {
    const c: Counters = new Map();
    for (const { name, count, sum } of rows) {
        const e = c.get(name) ?? { count: 0, sum: 0 };
        c.set(name, { count: e.count + count, sum: e.sum + sum });
    }
    return c;
}

const countOf = (c: Counters, name: string) => c.get(name)?.count ?? 0;

// Counts of `prefix.<key>` names, by key (one level only).
function byKey(c: Counters, prefix: string): Record<string, number> {
    const out: Record<string, number> = {};
    for (const [name, { count }] of c) {
        if (!name.startsWith(`${prefix}.`)) continue;
        const key = name.slice(prefix.length + 1);
        if (!key.includes('.')) out[key] = (out[key] ?? 0) + count;
    }
    return out;
}

const total = (r: Record<string, number>) => Object.values(r).reduce((a, b) => a + b, 0);

export interface Timing { runs: number; avgMs: number; p50Ms: number | null; p95Ms: number | null }

// Reads what recordLatency(name, ...) wrote.
function timing(c: Counters, name: string): Timing {
    const ms = c.get(`${name}.ms`) ?? { count: 0, sum: 0 };
    const histogram = new Map(Object.entries(byKey(c, name)).filter(([k]) => k.startsWith('lat_')).map(([k, v]) => [k.slice(4), v]));
    return {
        runs: ms.count,
        avgMs: ms.count > 0 ? ms.sum / ms.count : 0,
        p50Ms: percentile(histogram, ms.count, 0.5),
        p95Ms: percentile(histogram, ms.count, 0.95),
    };
}

export function summarizeUsage(rows: CounterRow[]) {
    const c = toCounters(rows);
    const regions = Object.entries(byKey(c, 'region'))
        .map(([cell, count]) => {
            const [lat, lon] = cell.split(',').map(Number);
            return { lat, lon, count };
        })
        .sort((a, b) => b.count - a.count)
        .slice(0, 10);
    return {
        routes: byKey(c, 'usage.route'),
        exports: byKey(c, 'usage.export'),
        imports: byKey(c, 'usage.import'),
        stravaSyncs: byKey(c, 'usage.strava_sync'),
        statsOpens: countOf(c, 'usage.stats_open'),
        regions,
    };
}

export function summarizeObservability(rows: CounterRow[]) {
    const c = toCounters(rows);
    const services = [...new Set([...c.keys()].filter(n => n.startsWith('ext.')).map(n => n.split('.')[1]))]
        .map(service => ({
            service,
            requests: countOf(c, `ext.${service}.requests`),
            errors: countOf(c, `ext.${service}.error`),
            rateLimited: countOf(c, `ext.${service}.rate_limited`),
            breaker: countOf(c, `ext.${service}.breaker`),
        }))
        .sort((a, b) => b.requests - a.requests);
    const caches = ['osm', 'graph', 'geocode'].map(cache => {
        const tiers = byKey(c, `cache.${cache}`);
        const { miss = 0, ...hits } = tiers;
        const lookups = total(tiers);
        return { cache, hits, misses: miss, hitRate: lookups > 0 ? (lookups - miss) / lookups : null };
    });
    const sizes = byKey(c, 'cpp.route_mi');
    return {
        routing: {
            solve: timing(c, 'cpp.solve'),
            sizes: [...ROUTE_MILES_BUCKETS.map(String), 'inf'].map(bound => ({ bound, count: sizes[bound] ?? 0 })),
            tooLarge: byKey(c, 'cpp.too_large'),
        },
        services,
        caches,
        workers: ['ridden_roads', 'athlete_sync'].map(job => ({ job, ...timing(c, `worker.${job}`), failed: countOf(c, `worker.${job}.failed`) })),
        rateLimited: byKey(c, 'ratelimit'),
    };
}

// Lost work and user-visible errors are rare, so they're summed over 30 days (#117).
const LOST_WORK = ['worker.athlete_sync.given_up', 'worker.athlete_sync.no_creds', 'worker.enqueue_failed', 'worker.ridden_roads.tile_failed'];
export const MONTHLY_PREFIXES = ['usage.', 'region.', 'account.', 'webhook.', 'client_error.'];

export function summarizeFailures(dayRows: CounterRow[], monthRows: CounterRow[]) {
    const day = toCounters(dayRows);
    const month = toCounters(monthRows);
    const dayErrors = byKey(day, 'client_error');
    const monthErrors = byKey(month, 'client_error');
    const memory = [...new Set([...day.keys()].filter(n => n.startsWith('memory.')).map(n => n.split('.')[1]))].map(process => {
        const samples = day.get(`memory.${process}.pct`) ?? { count: 0, sum: 0 };
        const buckets = byKey(day, `memory.${process}`);
        const peak = ['over', ...[...HEAP_PCT_BUCKETS].reverse().map(String)].find(b => buckets[`pct_${b}`]) ?? null;
        return { process, samples: samples.count, avgPct: samples.count > 0 ? samples.sum / samples.count : 0, peak };
    });
    return {
        userErrors: Object.keys(monthErrors)
            .map(kind => ({ kind, day: dayErrors[kind] ?? 0, month: monthErrors[kind] }))
            .sort((x, y) => y.month - x.month),
        accountHealth: byKey(month, 'account'),
        lostWork: {
            syncGivenUp: countOf(month, 'worker.athlete_sync.given_up'),
            syncNoCredentials: countOf(month, 'worker.athlete_sync.no_creds'),
            enqueueFailed: countOf(month, 'worker.enqueue_failed'),
            tilesFailed: countOf(month, 'worker.ridden_roads.tile_failed'),
            webhook: byKey(month, 'webhook'),
        },
        memory,
    };
}

export async function getAdminStats(now = Date.now()) {
    const since = (ms: number) => new Date(now - ms);
    const [
        totalUsers, stravaLinked, creditOn, withHistory,
        newDay, newWeek, newMonth, activeDay, activeWeek, activeMonth,
        exportedTotal, exportedMonth,
        riddenJobs, syncPending, syncRetrying, oldestSync,
        dayRows, monthRows,
    ] = await Promise.all([
        prisma.user.count(),
        prisma.account.count({ where: { provider: 'strava', refresh_token: { not: null } } }),
        prisma.user.count({ where: { creditRoutesOnStrava: true } }),
        prisma.stravaActivityCache.count(),
        prisma.user.count({ where: { createdAt: { gte: since(DAY_MS) } } }),
        prisma.user.count({ where: { createdAt: { gte: since(7 * DAY_MS) } } }),
        prisma.user.count({ where: { createdAt: { gte: since(30 * DAY_MS) } } }),
        prisma.user.count({ where: { lastSeenAt: { gte: since(DAY_MS) } } }),
        prisma.user.count({ where: { lastSeenAt: { gte: since(7 * DAY_MS) } } }),
        prisma.user.count({ where: { lastSeenAt: { gte: since(30 * DAY_MS) } } }),
        prisma.exportedRoute.count(),
        prisma.exportedRoute.count({ where: { createdAt: { gte: since(30 * DAY_MS) } } }),
        prisma.riddenRoadsJob.groupBy({ by: ['status'], _count: { _all: true } }),
        prisma.stravaSyncEvent.count(),
        prisma.stravaSyncEvent.count({ where: { attempts: { gt: 0 } } }),
        prisma.stravaSyncEvent.findFirst({ orderBy: { createdAt: 'asc' }, select: { createdAt: true } }),
        prisma.metricCounter.groupBy({ by: ['name'], where: { bucket: { gte: since(DAY_MS) } }, _sum: { count: true, sum: true } }),
        prisma.metricCounter.groupBy({
            by: ['name'],
            where: { bucket: { gte: since(30 * DAY_MS) }, OR: [...MONTHLY_PREFIXES.map(p => ({ name: { startsWith: p } })), { name: { in: LOST_WORK } }] },
            _sum: { count: true, sum: true },
        }),
    ]);
    const counterRows = (rows: typeof dayRows) => rows.map(r => ({ name: r.name, count: r._sum.count ?? 0, sum: r._sum.sum ?? 0 }));
    const day = counterRows(dayRows);
    const month = counterRows(monthRows);

    return {
        users: {
            total: totalUsers, stravaLinked, withHistory, creditOn,
            new: { day: newDay, week: newWeek, month: newMonth },
            active: { day: activeDay, week: activeWeek, month: activeMonth },
        },
        exportedRoutes: { total: exportedTotal, month: exportedMonth },
        queues: {
            riddenRoads: Object.fromEntries(riddenJobs.map(j => [j.status, j._count._all])) as Record<string, number>,
            stravaSync: { pending: syncPending, retrying: syncRetrying, oldestAgeMs: oldestSync ? now - oldestSync.createdAt.getTime() : null },
        },
        api: summarizeApiMetrics(day),
        usage: summarizeUsage(month),
        observability: summarizeObservability(day),
        failures: summarizeFailures(day, month),
    };
}

export type AdminStats = Awaited<ReturnType<typeof getAdminStats>>;
