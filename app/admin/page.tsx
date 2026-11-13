import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getAdminStats, isAdminUser, RouteHealth } from '@/lib/adminStats';

export const metadata: Metadata = { title: 'Admin - StreetSweep' };
export const dynamic = 'force-dynamic';

const FLY_MONITORING_URL = 'https://fly.io/apps/streetsweep/monitoring';

function Tile({ label, value, detail }: { label: string; value: number | string; detail?: string }) {
    return (
        <div className="bg-white border border-gray-200 rounded-lg p-4">
            <div className="text-xs font-medium text-gray-500">{label}</div>
            <div className="text-2xl font-semibold text-gray-900 tabular-nums mt-1">{value}</div>
            {detail && <div className="text-xs text-gray-500 mt-1">{detail}</div>}
        </div>
    );
}

const formatMs = (ms: number | null) => ms === null ? '>60s' : ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`;
const formatAge = (ms: number | null) => ms === null ? '—' : ms < 60_000 ? `${Math.round(ms / 1000)}s` : `${Math.round(ms / 60_000)}m`;

function ApiTable({ rows }: { rows: RouteHealth[] }) {
    if (rows.length === 0) return <p className="text-sm text-gray-500">No requests recorded in the last 24 hours.</p>;
    return (
        <div className="overflow-x-auto bg-white border border-gray-200 rounded-lg">
            <table className="w-full text-sm">
                <thead className="bg-gray-50 text-gray-500 text-xs">
                    <tr>
                        <th className="text-left font-medium px-3 py-2">Route</th>
                        <th className="text-right font-medium px-3 py-2">Requests</th>
                        <th className="text-right font-medium px-3 py-2">4xx</th>
                        <th className="text-right font-medium px-3 py-2">5xx</th>
                        <th className="text-right font-medium px-3 py-2">Avg</th>
                        <th className="text-right font-medium px-3 py-2">p50</th>
                        <th className="text-right font-medium px-3 py-2">p95</th>
                    </tr>
                </thead>
                <tbody className="tabular-nums">
                    {rows.map(r => (
                        <tr key={r.route} className="border-t border-gray-100">
                            <td className="px-3 py-2 font-mono text-xs text-gray-800 whitespace-nowrap">{r.route}</td>
                            <td className="px-3 py-2 text-right">{r.requests}</td>
                            <td className="px-3 py-2 text-right">{r.clientErrors}</td>
                            <td className={`px-3 py-2 text-right ${r.serverErrors > 0 ? 'text-red-600 font-semibold' : ''}`}>{r.serverErrors}</td>
                            <td className="px-3 py-2 text-right">{formatMs(r.avgMs)}</td>
                            <td className="px-3 py-2 text-right">{formatMs(r.p50Ms)}</td>
                            <td className="px-3 py-2 text-right">{formatMs(r.p95Ms)}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

function Table({ headers, rows, empty }: { headers: string[]; rows: ReactNode[][]; empty: string }) {
    if (rows.length === 0) return <p className="text-sm text-gray-500">{empty}</p>;
    return (
        <div className="overflow-x-auto bg-white border border-gray-200 rounded-lg">
            <table className="w-full text-sm">
                <thead className="bg-gray-50 text-gray-500 text-xs">
                    <tr>{headers.map((h, i) => <th key={h} className={`${i === 0 ? 'text-left' : 'text-right'} font-medium px-3 py-2`}>{h}</th>)}</tr>
                </thead>
                <tbody className="tabular-nums">
                    {rows.map((cells, r) => (
                        <tr key={r} className="border-t border-gray-100">
                            {cells.map((cell, i) => <td key={i} className={`px-3 py-2 ${i === 0 ? 'text-left font-mono text-xs text-gray-800 whitespace-nowrap' : 'text-right'}`}>{cell}</td>)}
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
    return (
        <section className="space-y-3">
            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">{title}</h2>
            {children}
        </section>
    );
}

const sum = (r: Record<string, number>) => Object.values(r).reduce((a, b) => a + b, 0);
// "3 gpx · 1 fit", in the given key order, skipping zeros; '—' when empty.
const breakdown = (r: Record<string, number>, order: string[] = Object.keys(r)) =>
    order.filter(k => r[k]).map(k => `${r[k]} ${k}`).join(' · ') || '—';
const percent = (rate: number | null) => rate === null ? '—' : `${Math.round(rate * 100)}%`;
const formatCell = (lat: number, lon: number) => `${Math.abs(lat)}°${lat >= 0 ? 'N' : 'S'} ${Math.abs(lon)}°${lon >= 0 ? 'E' : 'W'}`;
const HEAP_LABELS: Record<string, string> = { '50': '≤50%', '75': '50–75%', '90': '75–90%', over: '>90%' };
const red = (n: number) => <span className={n > 0 ? 'text-red-600 font-semibold' : ''}>{n}</span>;
const SIZE_LABELS: Record<string, string> = { '5': '<5 mi', '10': '5–10', '25': '10–25', '50': '25–50', inf: '50+' };

export default async function AdminPage() {
    const session = await getServerSession(authOptions);
    if (!(await isAdminUser((session?.user as { id?: string } | undefined)?.id))) notFound();
    const stats = await getAdminStats();
    const { users, exportedRoutes, queues, usage, observability, failures } = stats;
    const { accountHealth, lostWork } = failures;
    const { routing } = observability;

    return (
        <main className="min-h-screen bg-gray-50 text-gray-800">
            <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8 space-y-8">
                <div className="space-y-2">
                    <div className="flex items-baseline justify-between gap-4 flex-wrap">
                        <Link href="/" className="text-sm text-indigo-600 hover:underline">
                            ← Back to StreetSweep
                        </Link>
                        <a href={FLY_MONITORING_URL} target="_blank" rel="noreferrer" className="text-sm text-indigo-600 hover:underline">
                            Fly machine metrics →
                        </a>
                    </div>
                    <h1 className="text-2xl font-bold text-gray-900">Admin</h1>
                </div>

                <section className="space-y-3">
                    <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">Users</h2>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                        <Tile label="Total users" value={users.total} detail={`+${users.new.day} today · +${users.new.week} this week · +${users.new.month} in 30d`} />
                        <Tile label="Active today" value={users.active.day} />
                        <Tile label="Active this week" value={users.active.week} />
                        <Tile label="Active in 30 days" value={users.active.month} />
                        <Tile label="Strava linked" value={users.stravaLinked} />
                        <Tile label="Ride history synced" value={users.withHistory} />
                        <Tile label="Strava credit on" value={users.creditOn} />
                        <Tile label="Exported routes" value={exportedRoutes.total} detail={`${exportedRoutes.month} in 30d`} />
                    </div>
                </section>

                <section className="space-y-3">
                    <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">Background work</h2>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                        <Tile label="Ridden-roads jobs queued" value={(queues.riddenRoads.queued ?? 0) + (queues.riddenRoads.running ?? 0)} detail={`${queues.riddenRoads.running ?? 0} running`} />
                        <Tile label="Ridden-roads jobs failed" value={queues.riddenRoads.failed ?? 0} />
                        <Tile label="Strava sync events" value={queues.stravaSync.pending} detail={`oldest ${formatAge(queues.stravaSync.oldestAgeMs)}`} />
                        <Tile label="Strava sync retrying" value={queues.stravaSync.retrying} />
                    </div>
                    <Table
                        headers={['Job, last 24 hours', 'Runs', 'Failed', 'Avg', 'p50', 'p95']}
                        rows={observability.workers.map(w => [w.job, w.runs, red(w.failed), formatMs(w.avgMs), formatMs(w.p50Ms), formatMs(w.p95Ms)])}
                        empty=""
                    />
                </section>

                <Section title="Errors users saw">
                    <Table
                        headers={['Error', 'Last 24 hours', 'Last 30 days']}
                        rows={failures.userErrors.map(e => [e.kind, red(e.day), e.month])}
                        empty="No errors reported by browsers in the last 30 days."
                    />
                </Section>

                <Section title="Account health, last 30 days">
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                        <Tile label="Strava tokens rejected" value={accountHealth.strava_token_rejected ?? 0} detail="refreshes Strava refused" />
                        <Tile label="Revoked Strava access" value={accountHealth.strava_deauthorized ?? 0} />
                        <Tile label="Accounts deleted" value={accountHealth.deleted ?? 0} />
                        <Tile label="Sign-in errors" value={accountHealth.signin_error ?? 0} />
                        <Tile label="Ride credit failures" value={accountHealth.route_credit_failed ?? 0} />
                    </div>
                </Section>

                <Section title="Lost background work, last 30 days">
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                        <Tile label="Strava syncs given up" value={lostWork.syncGivenUp} detail="after 5 attempts" />
                        <Tile label="Sync events dropped" value={lostWork.syncNoCredentials} detail="no credentials to act on" />
                        <Tile label="Queue writes failed" value={lostWork.enqueueFailed} />
                        <Tile label="Ridden-road tiles failed" value={lostWork.tilesFailed} detail="retried next tick" />
                        <Tile label="Webhook events rejected" value={lostWork.webhook.rejected ?? 0} detail={`${lostWork.webhook.ignored ?? 0} ignored · ${lostWork.webhook.deauth_unconfirmed ?? 0} unconfirmed revokes`} />
                    </div>
                </Section>

                <Section title="Memory, last 24 hours">
                    <Table
                        headers={['Process', 'Samples', 'Avg heap used', 'Peak']}
                        rows={failures.memory.map(m => [
                            m.process, m.samples, `${Math.round(m.avgPct)}%`,
                            <span key="p" className={m.peak === 'over' ? 'text-red-600 font-semibold' : ''}>{m.peak ? HEAP_LABELS[m.peak] : '—'}</span>,
                        ])}
                        empty="No memory samples in the last 24 hours."
                    />
                </Section>

                <Section title="Usage, last 30 days">
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                        <Tile label="Routes generated" value={sum(usage.routes)} detail={breakdown(usage.routes, ['point', 'area', 'lasso', 'mixed'])} />
                        <Tile label="Exports" value={sum(usage.exports)} detail={breakdown(usage.exports, ['gpx', 'fit', 'garmin', 'library'])} />
                        <Tile label="Imports" value={sum(usage.imports)} detail={breakdown(usage.imports)} />
                        <Tile label="Stats opens" value={usage.statsOpens} />
                        <Tile label="Strava syncs" value={sum(usage.stravaSyncs)} detail={breakdown(usage.stravaSyncs, ['incremental', 'full'])} />
                    </div>
                    <Table
                        headers={['Top regions (1° cells)', 'Routes']}
                        rows={usage.regions.map(r => [
                            <a key="r" href={`https://www.openstreetmap.org/#map=8/${r.lat + 0.5}/${r.lon + 0.5}`} target="_blank" rel="noreferrer" className="text-indigo-600 hover:underline">{formatCell(r.lat, r.lon)}</a>,
                            r.count,
                        ])}
                        empty="No routes generated in the last 30 days."
                    />
                </Section>

                <Section title="Routing engine, last 24 hours">
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                        <Tile label="Route solves" value={routing.solve.runs} detail={`avg ${formatMs(routing.solve.avgMs)} · p50 ${formatMs(routing.solve.p50Ms)} · p95 ${formatMs(routing.solve.p95Ms)}`} />
                        <Tile label="Route length" value={routing.sizes.reduce((n, s) => n + s.count, 0)} detail={routing.sizes.map(s => `${SIZE_LABELS[s.bound]}: ${s.count}`).join(' · ')} />
                        <Tile label="Too large, rejected" value={sum(routing.tooLarge)} detail={breakdown(routing.tooLarge, ['area', 'span'])} />
                    </div>
                </Section>

                <Section title="External services, last 24 hours">
                    <Table
                        headers={['Service', 'Requests', 'Errors', 'Rate limited', 'Breaker trips']}
                        rows={observability.services.map(s => [
                            s.service, s.requests, red(s.errors), s.rateLimited, s.breaker,
                        ])}
                        empty="No external calls recorded in the last 24 hours."
                    />
                </Section>

                <Section title="Caches, last 24 hours">
                    <Table
                        headers={['Cache', 'Lookups', 'Hit rate', 'Hits by tier']}
                        rows={observability.caches.map(c => [c.cache, sum(c.hits) + c.misses, percent(c.hitRate), breakdown(c.hits)])}
                        empty=""
                    />
                </Section>

                <Section title="API, last 24 hours">
                    <ApiTable rows={stats.api} />
                    <p className="text-sm text-gray-500">Rate limited (429): {breakdown(observability.rateLimited)}</p>
                </Section>
            </div>
        </main>
    );
}
