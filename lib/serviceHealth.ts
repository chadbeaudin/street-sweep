import { prisma } from './prisma';
import { sendTelegramMessage } from './telegram';

// The self-hosted backends (#129). The database is required; without Overpass
// or Open Topo Data the app falls back to slower public mirrors.
export type ServiceName = 'database' | 'overpass' | 'elevation';
export type ServiceStatus = Record<ServiceName, boolean>;

const PROBE_TIMEOUT_MS = 4000;
const CACHE_MS = 30 * 1000;
const LABELS: Record<ServiceName, string> = { database: 'Postgres', overpass: 'Overpass', elevation: 'Open Topo Data' };

function withTimeout<T>(p: Promise<T>): Promise<T> {
    return Promise.race([p, new Promise<T>((_, reject) => setTimeout(() => reject(new Error('timed out')), PROBE_TIMEOUT_MS))]);
}

async function probeHttp(url: string): Promise<void> {
    const res = await fetch(url, { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS), cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
}

const PROBES: Record<ServiceName, () => Promise<unknown>> = {
    database: () => withTimeout(prisma.$queryRawUnsafe('SELECT 1')),
    overpass: () => process.env.OVERPASS_URL ? probeHttp(process.env.OVERPASS_URL.replace(/interpreter$/, 'status')) : Promise.resolve(),
    elevation: () => probeHttp(`${process.env.OPEN_TOPO_URL || 'https://opentopodata.bigtimber.cloud'}/v1/copernicus90?locations=0,0`),
};

const downSince = new Map<ServiceName, number>();

// Alerts on transitions only, so an outage sends one message per process, not one per page load.
async function alertTransitions(results: Record<ServiceName, string | null>, now: number): Promise<void> {
    const messages: string[] = [];
    for (const name of Object.keys(results) as ServiceName[]) {
        const error = results[name];
        const since = downSince.get(name);
        if (error && since === undefined) {
            downSince.set(name, now);
            messages.push(`StreetSweep: ${LABELS[name]} is DOWN (${error})`);
        } else if (!error && since !== undefined) {
            downSince.delete(name);
            messages.push(`StreetSweep: ${LABELS[name]} is back up after ${Math.max(1, Math.round((now - since) / 60000))} min`);
        }
    }
    if (messages.length > 0) await sendTelegramMessage(messages.join('\n'));
}

let cached: { at: number; status: ServiceStatus } | null = null;
let inFlight: Promise<ServiceStatus> | null = null;

export async function checkServices(now = Date.now()): Promise<ServiceStatus> {
    if (cached && now - cached.at < CACHE_MS) return cached.status;
    inFlight ??= (async () => {
        const names = Object.keys(PROBES) as ServiceName[];
        const settled = await Promise.allSettled(names.map(n => PROBES[n]()));
        const results = Object.fromEntries(names.map((n, i) => {
            const r = settled[i];
            return [n, r.status === 'rejected' ? (r.reason?.message ?? String(r.reason)) : null];
        })) as Record<ServiceName, string | null>;
        await alertTransitions(results, now);
        const status = Object.fromEntries(names.map(n => [n, results[n] === null])) as ServiceStatus;
        cached = { at: now, status };
        return status;
    })().finally(() => { inFlight = null; });
    return inFlight;
}
