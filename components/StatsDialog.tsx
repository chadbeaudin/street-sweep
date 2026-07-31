'use client';

import { useEffect, useState } from 'react';
import { X, Loader2, MapPin, RefreshCw, ChevronDown, Globe, Map as MapIcon, Landmark, Building2, Activity, Mountain, Route } from 'lucide-react';

interface CityStats {
    name: string;
    state: string | null;
    activityCount: number;
    riddenMiles: number;
    totalMiles: number;
    percent: number;
}

interface StatsResponse {
    totalActivities?: number;
    totalUniqueMiles?: number;
    totalElevationFeet?: number;
    cities?: CityStats[];
    bikingStats?: {
        countries: string[];
        states: string[];
        counties: string[];
        cities: string[];
    };
    refreshedAt?: string | null;
    stale?: boolean;
    refreshing?: boolean;
    computing?: boolean;
}

interface StatsDialogProps {
    isOpen: boolean;
    onClose: () => void;
    riddenRoads: [number, number][][] | null;
    activityElevations: number[];
    activityTypes: string[];
    stravaCredentials: any;
}

type GeoKey = 'countries' | 'states' | 'counties' | 'cities';

const GEO_TILES: { key: GeoKey; label: string; Icon: typeof Globe; accent: string; ring: string; text: string; iconColor: string }[] = [
    { key: 'countries', label: 'Countries', Icon: Globe, accent: 'bg-emerald-50 border-emerald-100 hover:bg-emerald-100/70', ring: 'ring-emerald-400 bg-emerald-100/70', text: 'text-emerald-900', iconColor: 'text-emerald-500' },
    { key: 'states', label: 'States', Icon: MapIcon, accent: 'bg-teal-50 border-teal-100 hover:bg-teal-100/70', ring: 'ring-teal-400 bg-teal-100/70', text: 'text-teal-900', iconColor: 'text-teal-500' },
    { key: 'counties', label: 'Counties', Icon: Landmark, accent: 'bg-cyan-50 border-cyan-100 hover:bg-cyan-100/70', ring: 'ring-cyan-400 bg-cyan-100/70', text: 'text-cyan-900', iconColor: 'text-cyan-500' },
    { key: 'cities', label: 'Cities', Icon: Building2, accent: 'bg-sky-50 border-sky-100 hover:bg-sky-100/70', ring: 'ring-sky-400 bg-sky-100/70', text: 'text-sky-900', iconColor: 'text-sky-500' },
];

function formatAge(refreshedAt?: string): string | null {
    if (!refreshedAt) return null;
    const ms = Date.now() - new Date(refreshedAt).getTime();
    const mins = Math.floor(ms / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins} min ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
}

export function StatsDialog({ isOpen, onClose, riddenRoads, activityElevations, activityTypes, stravaCredentials }: StatsDialogProps) {
    const [stats, setStats] = useState<StatsResponse | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [expanded, setExpanded] = useState<GeoKey | null>(null);

    useEffect(() => { if (!isOpen) setExpanded(null); }, [isOpen]);

    useEffect(() => {
        if (!isOpen) return;
        if (!riddenRoads || riddenRoads.length === 0) {
            setStats({ totalActivities: 0, totalUniqueMiles: 0, totalElevationFeet: 0, cities: [] });
            return;
        }

        let cancelled = false;
        let pollTimer: ReturnType<typeof setTimeout> | null = null;

        const fetchOnce = async (isInitial: boolean) => {
            if (isInitial) setLoading(true);
            try {
                // Only credentials are sent — the server fetches the ride set
                // itself, so we never ship the full decoded polylines (which a
                // proxy would reject as too large).
                const res = await fetch('/api/stats', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ stravaCredentials })
                });
                const data = await res.json();
                if (cancelled) return;
                if (data.error) {
                    setError(data.error);
                } else {
                    setStats(data);
                    // Poll while a background compute is in progress so the UI
                    // shows fresh numbers as soon as they land.
                    if ((data.computing || data.refreshing) && !cancelled) {
                        pollTimer = setTimeout(() => fetchOnce(false), 5000);
                    }
                }
            } catch (err: any) {
                if (!cancelled) setError(err.message);
            } finally {
                if (isInitial && !cancelled) setLoading(false);
            }
        };

        setError(null);
        fetchOnce(true);

        return () => {
            cancelled = true;
            if (pollTimer) clearTimeout(pollTimer);
        };
    }, [isOpen, riddenRoads, stravaCredentials]);

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[2000] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
            <div className="bg-white rounded-xl shadow-2xl max-w-lg w-full max-h-[85vh] overflow-y-auto">
                <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
                    <div>
                        <h2 className="text-lg font-semibold text-gray-900">Your Coverage</h2>
                        {stats?.refreshedAt && (
                            <div className="flex items-center gap-1.5 text-xs text-gray-500 mt-0.5">
                                <span>Updated {formatAge(stats.refreshedAt)}</span>
                                {stats.refreshing && (
                                    <span className="inline-flex items-center gap-1 text-indigo-600">
                                        <RefreshCw className="w-3 h-3 animate-spin" /> refreshing
                                    </span>
                                )}
                            </div>
                        )}
                    </div>
                    <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors">
                        <X className="w-5 h-5" />
                    </button>
                </div>

                <div className="p-6 space-y-6">
                    {loading && (
                        <div className="flex flex-col items-center gap-3 py-12 text-gray-500">
                            <Loader2 className="w-8 h-8 animate-spin text-indigo-600" />
                            <p className="text-sm">Crunching your rides…</p>
                        </div>
                    )}

                    {error && (
                        <div className="rounded-md bg-red-50 border border-red-200 p-4 text-sm text-red-700">
                            {error}
                        </div>
                    )}

                    {!loading && !error && stats && stats.computing && (
                        <div className="flex flex-col items-center gap-3 py-12 text-gray-500">
                            <Loader2 className="w-8 h-8 animate-spin text-indigo-600" />
                            <p className="text-sm font-medium">Computing your first stats…</p>
                            <p className="text-xs text-gray-400 text-center max-w-xs">
                                Big histories can take a few minutes. You can close this dialog — the
                                results will be cached and ready instantly next time you open it.
                            </p>
                        </div>
                    )}

                    {!loading && !error && stats && !stats.computing && stats.totalActivities !== undefined && (
                        <>
                            <div className="grid grid-cols-3 gap-3">
                                <div className="relative overflow-hidden bg-gradient-to-br from-gray-50 to-gray-100 rounded-xl p-4 border border-gray-100">
                                    <Activity className="w-4 h-4 text-gray-400 mb-1.5" />
                                    <div className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider">Activities</div>
                                    <div className="text-3xl font-bold text-gray-900 mt-0.5 tabular-nums">{stats.totalActivities}</div>
                                </div>
                                <div className="relative overflow-hidden bg-gradient-to-br from-indigo-50 to-indigo-100/60 rounded-xl p-4 border border-indigo-100">
                                    <Route className="w-4 h-4 text-indigo-400 mb-1.5" />
                                    <div className="text-[11px] font-semibold text-indigo-700 uppercase tracking-wider">Unique Miles</div>
                                    <div className="text-3xl font-bold text-indigo-900 mt-0.5 tabular-nums">{(stats.totalUniqueMiles ?? 0).toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}</div>
                                    <div className="text-[11px] text-indigo-500 mt-0.5">deduplicated</div>
                                </div>
                                <div className="relative overflow-hidden bg-gradient-to-br from-amber-50 to-amber-100/60 rounded-xl p-4 border border-amber-100">
                                    <Mountain className="w-4 h-4 text-amber-400 mb-1.5" />
                                    <div className="text-[11px] font-semibold text-amber-700 uppercase tracking-wider">Climbed</div>
                                    <div className="text-3xl font-bold text-amber-900 mt-0.5 tabular-nums">{Math.round(stats.totalElevationFeet ?? 0).toLocaleString()}</div>
                                    <div className="text-[11px] text-amber-500 mt-0.5">ft total</div>
                                </div>
                            </div>

                            <div>
                                <h3 className="text-sm font-semibold text-gray-700 mb-3">Biking Locations Ridden</h3>
                                <div className="grid grid-cols-4 gap-2">
                                    {GEO_TILES.map(({ key, label, Icon, accent, ring, text, iconColor }) => {
                                        const raw = stats.bikingStats?.[key];
                                        const list = Array.isArray(raw) ? raw : [];
                                        const isOpen = expanded === key;
                                        return (
                                            <button
                                                key={key}
                                                type="button"
                                                onClick={() => setExpanded(isOpen ? null : key)}
                                                aria-expanded={isOpen}
                                                className={`relative rounded-lg border p-3 text-center transition-all ${isOpen ? `ring-2 ${ring}` : accent}`}
                                            >
                                                <Icon className={`w-4 h-4 mx-auto mb-1 ${iconColor}`} />
                                                <div className={`text-[10px] font-bold uppercase tracking-wider ${text} opacity-80`}>{label}</div>
                                                <div className={`text-2xl font-black ${text} leading-tight`}>{list.length}</div>
                                                <ChevronDown className={`w-3 h-3 mx-auto mt-0.5 ${text} opacity-60 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
                                            </button>
                                        );
                                    })}
                                </div>
                                {expanded && (
                                    <div className="mt-2 rounded-lg border border-gray-200 bg-gray-50/70 overflow-hidden">
                                        {(() => {
                                            const raw = stats.bikingStats?.[expanded];
                                            const list = Array.isArray(raw) ? raw : [];
                                            const tile = GEO_TILES.find(t => t.key === expanded)!;
                                            return (
                                                <>
                                                    <div className="flex items-center justify-between px-3 py-2 border-b border-gray-200 bg-white">
                                                        <span className="text-xs font-semibold text-gray-700">{list.length} {tile.label}</span>
                                                        <button onClick={() => setExpanded(null)} className="text-gray-400 hover:text-gray-600"><X className="w-3.5 h-3.5" /></button>
                                                    </div>
                                                    {list.length === 0 ? (
                                                        <p className="px-3 py-4 text-sm text-gray-500 text-center">None detected yet.</p>
                                                    ) : (
                                                        <ul className="max-h-52 overflow-y-auto py-1">
                                                            {list.map(name => (
                                                                <li key={name} className="flex items-center gap-2 px-3 py-1.5 text-sm text-gray-700 hover:bg-white">
                                                                    <MapPin className={`w-3.5 h-3.5 flex-shrink-0 ${tile.iconColor}`} />
                                                                    <span className="truncate">{name}</span>
                                                                </li>
                                                            ))}
                                                        </ul>
                                                    )}
                                                </>
                                            );
                                        })()}
                                    </div>
                                )}
                            </div>

                            <div>
                                <div className="flex items-center justify-between mb-3">
                                    <h3 className="text-sm font-semibold text-gray-700">Top Cities by Coverage</h3>
                                    <span className="text-xs text-gray-400">ridden ÷ total roads</span>
                                </div>
                                {!stats.cities || stats.cities.length === 0 ? (
                                    <p className="text-sm text-gray-500">No cities detected yet.</p>
                                ) : (
                                    <div className="space-y-2">
                                        {stats.cities.map((c, i) => {
                                            const pct = Math.min(100, c.percent);
                                            const barColor = c.percent >= 25 ? 'bg-emerald-500' : c.percent >= 5 ? 'bg-teal-500' : 'bg-sky-400';
                                            return (
                                                <div key={`${c.name}-${c.state ?? ''}`} className="bg-white border border-gray-200 rounded-xl p-3 hover:border-gray-300 transition-colors">
                                                    <div className="flex items-center justify-between gap-2">
                                                        <div className="flex items-center gap-2.5 min-w-0">
                                                            <span className="flex-shrink-0 w-5 h-5 rounded-full bg-gray-100 text-gray-500 text-[11px] font-bold flex items-center justify-center">{i + 1}</span>
                                                            <div className="min-w-0">
                                                                <div className="font-medium text-gray-900 truncate">{c.name}{c.state ? `, ${c.state}` : ''}</div>
                                                                <div className="text-xs text-gray-500">{c.activityCount} {c.activityCount === 1 ? 'ride' : 'rides'}</div>
                                                            </div>
                                                        </div>
                                                        <div className="text-right flex-shrink-0">
                                                            <div className="text-lg font-bold text-gray-900 tabular-nums">{c.percent.toFixed(1)}%</div>
                                                            <div className="text-xs text-gray-500 tabular-nums">{c.riddenMiles.toFixed(0)} / {c.totalMiles.toFixed(0)} mi</div>
                                                        </div>
                                                    </div>
                                                    {c.totalMiles > 0 && (
                                                        <div className="mt-2 h-2 bg-gray-100 rounded-full overflow-hidden">
                                                            <div className={`h-full rounded-full ${barColor} transition-all`} style={{ width: `${pct}%` }} />
                                                        </div>
                                                    )}
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}
