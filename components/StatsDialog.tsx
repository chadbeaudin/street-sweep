'use client';

import { useEffect, useState } from 'react';
import { X, Loader2, MapPin, RefreshCw } from 'lucide-react';

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
        countries: number;
        states: number;
        counties: number;
        cities: number;
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
                const res = await fetch('/api/stats', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ riddenRoads, activityElevations, activityTypes, stravaCredentials })
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
    }, [isOpen, riddenRoads, activityElevations, activityTypes, stravaCredentials]);

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
                                <div className="bg-gray-50 rounded-lg p-4">
                                    <div className="text-xs font-medium text-gray-500 uppercase tracking-wider">Activities</div>
                                    <div className="text-3xl font-bold text-gray-900 mt-1">{stats.totalActivities}</div>
                                </div>
                                <div className="bg-indigo-50 rounded-lg p-4">
                                    <div className="text-xs font-medium text-indigo-700 uppercase tracking-wider">Unique Miles</div>
                                    <div className="text-3xl font-bold text-indigo-900 mt-1">{(stats.totalUniqueMiles ?? 0).toFixed(1)}</div>
                                    <div className="text-xs text-indigo-600 mt-1">deduplicated</div>
                                </div>
                                <div className="bg-amber-50 rounded-lg p-4">
                                    <div className="text-xs font-medium text-amber-700 uppercase tracking-wider">Climbed</div>
                                    <div className="text-3xl font-bold text-amber-900 mt-1">{Math.round(stats.totalElevationFeet ?? 0).toLocaleString()}</div>
                                    <div className="text-xs text-amber-600 mt-1">ft total</div>
                                </div>
                            </div>

                            <div>
                                <h3 className="text-sm font-semibold text-gray-700 mb-3">Biking Locations Ridden</h3>
                                <div className="grid grid-cols-4 gap-2 mb-4">
                                    <div className="bg-emerald-50 border border-emerald-100 rounded-lg p-3 text-center">
                                        <div className="text-[10px] font-bold text-emerald-800 uppercase tracking-wider">Countries</div>
                                        <div className="text-2xl font-black text-emerald-900 mt-0.5">{stats.bikingStats?.countries ?? 0}</div>
                                    </div>
                                    <div className="bg-teal-50 border border-teal-100 rounded-lg p-3 text-center">
                                        <div className="text-[10px] font-bold text-teal-800 uppercase tracking-wider">States</div>
                                        <div className="text-2xl font-black text-teal-900 mt-0.5">{stats.bikingStats?.states ?? 0}</div>
                                    </div>
                                    <div className="bg-cyan-50 border border-cyan-100 rounded-lg p-3 text-center">
                                        <div className="text-[10px] font-bold text-cyan-800 uppercase tracking-wider">Counties</div>
                                        <div className="text-2xl font-black text-cyan-900 mt-0.5">{stats.bikingStats?.counties ?? 0}</div>
                                    </div>
                                    <div className="bg-sky-50 border border-sky-100 rounded-lg p-3 text-center">
                                        <div className="text-[10px] font-bold text-sky-800 uppercase tracking-wider">Cities</div>
                                        <div className="text-2xl font-black text-sky-900 mt-0.5">{stats.bikingStats?.cities ?? 0}</div>
                                    </div>
                                </div>
                            </div>

                            <div>
                                <h3 className="text-sm font-semibold text-gray-700 mb-3">By City</h3>
                                {!stats.cities || stats.cities.length === 0 ? (
                                    <p className="text-sm text-gray-500">No cities detected yet.</p>
                                ) : (
                                    <div className="space-y-2">
                                        {stats.cities.map(c => (
                                            <div key={`${c.name}-${c.state ?? ''}`} className="bg-white border border-gray-200 rounded-lg p-3">
                                                <div className="flex items-center justify-between">
                                                    <div className="flex items-center gap-2">
                                                        <MapPin className="w-4 h-4 text-emerald-600" />
                                                        <div>
                                                            <div className="font-medium text-gray-900">{c.name}{c.state ? `, ${c.state}` : ''}</div>
                                                            <div className="text-xs text-gray-500">{c.activityCount} {c.activityCount === 1 ? 'ride' : 'rides'}</div>
                                                        </div>
                                                    </div>
                                                    <div className="text-right">
                                                        <div className="text-lg font-bold text-emerald-700">{c.percent.toFixed(1)}%</div>
                                                        <div className="text-xs text-gray-500">{c.riddenMiles.toFixed(1)} / {c.totalMiles.toFixed(1)} mi</div>
                                                    </div>
                                                </div>
                                                {c.totalMiles > 0 && (
                                                    <div className="mt-2 h-2 bg-gray-100 rounded-full overflow-hidden">
                                                        <div
                                                            className="h-full bg-emerald-500"
                                                            style={{ width: `${Math.min(100, c.percent)}%` }}
                                                        />
                                                    </div>
                                                )}
                                            </div>
                                        ))}
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
