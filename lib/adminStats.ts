import { prisma } from './prisma';
import { LATENCY_BUCKETS_MS } from './metrics';

const DAY_MS = 24 * 60 * 60 * 1000;

// Comma-separated Strava athlete ids allowed to see /admin (#117).
export function isAdminAthlete(athleteId: string | null | undefined): boolean {
    if (!athleteId) return false;
    return (process.env.ADMIN_ATHLETE_IDS ?? '').split(',').map(s => s.trim()).filter(Boolean).includes(athleteId);
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

export async function getAdminStats(now = Date.now()) {
    const since = (ms: number) => new Date(now - ms);
    const [
        totalUsers, stravaLinked, creditOn, withHistory,
        newDay, newWeek, newMonth, activeDay, activeWeek, activeMonth,
        exportedTotal, exportedMonth,
        riddenJobs, syncPending, syncRetrying, oldestSync,
        apiRows,
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
        prisma.metricCounter.groupBy({ by: ['name'], where: { bucket: { gte: since(DAY_MS) }, name: { startsWith: 'api.' } }, _sum: { count: true, sum: true } }),
    ]);

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
        api: summarizeApiMetrics(apiRows.map(r => ({ name: r.name, count: r._sum.count ?? 0, sum: r._sum.sum ?? 0 }))),
    };
}

export type AdminStats = Awaited<ReturnType<typeof getAdminStats>>;
