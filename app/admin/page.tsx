import type { Metadata } from 'next';
import { ArrowLeft } from 'lucide-react';
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

export default async function AdminPage() {
    const session = await getServerSession(authOptions);
    if (!(await isAdminUser((session?.user as { id?: string } | undefined)?.id))) notFound();
    const stats = await getAdminStats();
    const { users, exportedRoutes, queues } = stats;

    return (
        <main className="min-h-screen bg-gray-50 text-gray-800">
            <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8 space-y-8">
                <a href="/" className="inline-flex items-center gap-1 text-sm text-gray-600 hover:text-gray-900">
                    <ArrowLeft className="w-4 h-4" />
                    Back to StreetSweep
                </a>
                <div className="flex items-baseline justify-between gap-4 flex-wrap">
                    <h1 className="text-2xl font-bold text-gray-900">Admin</h1>
                    <a href={FLY_MONITORING_URL} target="_blank" rel="noreferrer" className="text-sm text-indigo-600 hover:underline">
                        Fly machine metrics →
                    </a>
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
                </section>

                <section className="space-y-3">
                    <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">API, last 24 hours</h2>
                    <ApiTable rows={stats.api} />
                </section>
            </div>
        </main>
    );
}
