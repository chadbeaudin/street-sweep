const ts = () => `[${new Date().toTimeString().slice(0, 8)}]`;

const HOUR_MS = 60 * 60 * 1000;
const FLUSH_INTERVAL_MS = 60 * 1000;
// Upper bounds (ms) of the request-latency histogram; slower ones land in lat_inf.
export const LATENCY_BUCKETS_MS = [100, 250, 500, 1000, 2500, 5000, 10000, 30000, 60000];

// Keyed by hour bucket too, so a count recorded at 10:59 but flushed at 11:00 still lands in 10:00.
const pending = new Map<string, { bucket: number; name: string; count: number; sum: number }>();
let timer: ReturnType<typeof setInterval> | null = null;

export function hourBucket(t: number): Date {
    return new Date(Math.floor(t / HOUR_MS) * HOUR_MS);
}

// Kept in memory and flushed in one batch a minute -- never a DB write per request.
export function incrementMetric(name: string, count = 1, sum = 0, now = Date.now()): void {
    const bucket = hourBucket(now).getTime();
    const key = `${bucket}|${name}`;
    const entry = pending.get(key) ?? { bucket, name, count: 0, sum: 0 };
    entry.count += count;
    entry.sum += sum;
    pending.set(key, entry);
    if (!timer) {
        timer = setInterval(() => { void flushMetrics(); }, FLUSH_INTERVAL_MS);
        timer.unref?.();
    }
}

export function recordLatency(name: string, ms: number, now = Date.now()): void {
    const bound = LATENCY_BUCKETS_MS.find(b => ms <= b);
    incrementMetric(`${name}.lat_${bound ?? 'inf'}`, 1, 0, now);
    incrementMetric(`${name}.ms`, 1, ms, now);
}

export async function flushMetrics(): Promise<void> {
    if (pending.size === 0) return;
    const batch = [...pending.values()];
    pending.clear();
    const values = batch.map((_, i) => `($${i * 4 + 1}, $${i * 4 + 2}, $${i * 4 + 3}, $${i * 4 + 4})`).join(', ');
    const params = batch.flatMap(e => [new Date(e.bucket), e.name, e.count, e.sum]);
    try {
        // Lazy: every API route imports this module, and most never touch the DB.
        const { prisma } = await import('./prisma');
        await prisma.$executeRawUnsafe(
            `INSERT INTO metric_counters (bucket, name, count, sum) VALUES ${values}
             ON CONFLICT (bucket, name) DO UPDATE SET count = metric_counters.count + EXCLUDED.count, sum = metric_counters.sum + EXCLUDED.sum`,
            ...params,
        );
    } catch (e: any) {
        console.warn(`${ts()} Metrics: flush failed, keeping ${batch.length} counters for the next one: ${e.message}`);
        for (const entry of batch) {
            const key = `${entry.bucket}|${entry.name}`;
            const current = pending.get(key);
            pending.set(key, current ? { ...entry, count: entry.count + current.count, sum: entry.sum + current.sum } : entry);
        }
    }
}

// Records count, 4xx/5xx and latency for an API route handler, without touching its body.
export function withApiMetrics<A extends unknown[], R extends { status: number }>(method: string, route: string, handler: (...args: A) => Promise<R>): (...args: A) => Promise<R> {
    const name = `api.${method} ${route}`;
    const record = (status: number, start: number) => {
        incrementMetric(`${name}.requests`);
        if (status >= 500) incrementMetric(`${name}.5xx`);
        else if (status >= 400) incrementMetric(`${name}.4xx`);
        recordLatency(name, Date.now() - start);
    };
    return async (...args: A) => {
        const start = Date.now();
        try {
            const res = await handler(...args);
            // Next.js answers 500 when a handler returns nothing.
            record((res as R | undefined)?.status ?? 500, start);
            return res;
        } catch (e) {
            record(500, start);
            throw e;
        }
    };
}

const SEEN_THROTTLE_MS = 15 * 60 * 1000;
const lastSeenWrite = new Map<string, number>();

// Called from the session callback (every page load / tab refocus), so it's
// throttled per user rather than a write on every session read.
export function touchUserLastSeen(userId: string, now = Date.now()): void {
    if (now - (lastSeenWrite.get(userId) ?? 0) < SEEN_THROTTLE_MS) return;
    lastSeenWrite.set(userId, now);
    import('./prisma')
        .then(({ prisma }) => prisma.user.update({ where: { id: userId }, data: { lastSeenAt: new Date(now) } }))
        .catch(e => console.warn(`${ts()} Metrics: lastSeenAt update failed for ${userId}: ${e.message}`));
}
