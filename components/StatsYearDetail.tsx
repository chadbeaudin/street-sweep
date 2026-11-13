'use client';

import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useUnits } from './UnitsContext';
import { StatsBarChart } from './StatsBarChart';
import { distanceFromMiles, distanceUnit, elevationFromFeet, elevationUnit } from '@/lib/units';
import { ridesInMonth, summarizeRides, type YearDetail, type YearRide } from '@/lib/stats';
import { reportClientError } from '@/lib/clientErrors';

interface StatsYearDetailProps {
    year: number;
    month: number | null;
    onSelectMonth: (month: number) => void;
    stravaCredentials: unknown;
    activityMode: 'cycling' | 'running';
    activityNounPlural: string;
}

const BIGGEST_RIDES = 3;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function RideRow({ ride, showType }: { ride: YearRide; showType: boolean }) {
    const { units } = useUnits();
    return (
        <a
            href={`https://www.strava.com/activities/${ride.id}`}
            target="_blank"
            rel="noopener noreferrer"
            title="View on Strava"
            className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-gray-50 transition-colors"
        >
            {showType && <span className={`w-2.5 h-2.5 rounded-sm flex-shrink-0 ${ride.mountainBike ? 'bg-emerald-500' : 'bg-indigo-400'}`} />}
            <span className="min-w-0 flex-1">
                <span className="block font-medium text-gray-900 truncate">{ride.name}</span>
                <span className="block text-xs text-gray-500">{new Date(ride.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>
            </span>
            <span className="text-right flex-shrink-0 tabular-nums">
                <span className="block font-semibold text-gray-900">{distanceFromMiles(ride.miles, units).toFixed(1)} {distanceUnit(units)}</span>
                <span className="block text-xs text-gray-500">{Math.round(elevationFromFeet(ride.elevationFeet, units)).toLocaleString()} {elevationUnit(units)}</span>
            </span>
        </a>
    );
}

export function StatsYearDetail({ year, month, onSelectMonth, stravaCredentials, activityMode, activityNounPlural }: StatsYearDetailProps) {
    const { units } = useUnits();
    const [detail, setDetail] = useState<YearDetail | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        setDetail(null);
        setError(null);
        (async () => {
            try {
                const res = await fetch('/api/stats/year', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ stravaCredentials, activityMode, year })
                });
                const data = await res.json();
                if (cancelled) return;
                if (data.error) {
                    reportClientError('stats_year');
                    setError(data.error);
                } else {
                    setDetail(data);
                }
            } catch (err) {
                if (cancelled) return;
                reportClientError('stats_year');
                setError(err instanceof Error ? err.message : `Couldn't load ${year}`);
            }
        })();
        return () => { cancelled = true; };
    }, [year, stravaCredentials, activityMode]);

    if (error) return <div className="rounded-md bg-red-50 border border-red-200 p-4 text-sm text-red-700">{error}</div>;
    if (!detail) return <div className="flex justify-center py-12"><Loader2 className="w-8 h-8 animate-spin text-indigo-600" /></div>;
    if (detail.rides.length === 0) return <p className="text-sm text-gray-500">No {activityNounPlural} in {year}.</p>;

    const showType = activityMode === 'cycling';
    const rides = month === null ? detail.rides : ridesInMonth(detail.rides, month);
    const totals = summarizeRides(rides);
    const tiles = [
        { label: 'Distance', value: Math.round(distanceFromMiles(totals.miles, units)).toLocaleString(), unit: distanceUnit(units) },
        { label: activityNounPlural, value: totals.rides.toLocaleString(), unit: 'total' },
        { label: 'Climbed', value: Math.round(elevationFromFeet(totals.elevationFeet, units)).toLocaleString(), unit: elevationUnit(units) },
        { label: 'Active Days', value: totals.activeDays.toLocaleString(), unit: 'days' },
    ];
    const biggest = [...rides].sort((a, b) => b.miles - a.miles).slice(0, BIGGEST_RIDES);

    return (
        <>
            <div className="grid grid-cols-4 gap-2">
                {tiles.map(t => (
                    <div key={t.label} className="bg-gray-50 border border-gray-100 rounded-xl p-3">
                        <div className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider">{t.label}</div>
                        <div className="text-xl font-bold text-gray-900 mt-0.5 tabular-nums whitespace-nowrap">{t.value}</div>
                        <div className="text-[10px] text-gray-400">{t.unit}</div>
                    </div>
                ))}
            </div>

            {month === null && (
                <StatsBarChart
                    title={`${units === 'metric' ? 'Kilometers' : 'Miles'} per Month`}
                    activityNounPlural={activityNounPlural}
                    onSelect={onSelectMonth}
                    bars={detail.months.map((m, i) => ({
                        key: m.month,
                        label: MONTHS[i].charAt(0),
                        tooltipTitle: `${MONTHS[i]} ${year}`,
                        miles: m.mountainMiles + m.roadGravelMiles,
                        rides: m.rides,
                        type: showType ? m : undefined,
                    }))}
                />
            )}

            {month === null && rides.length > BIGGEST_RIDES && (
                <div>
                    <h3 className="text-sm font-semibold text-gray-700 mb-3">Biggest {activityNounPlural.charAt(0).toUpperCase() + activityNounPlural.slice(1)}</h3>
                    <div className="border border-gray-200 rounded-xl divide-y divide-gray-100 overflow-hidden">
                        {biggest.map(r => <RideRow key={r.id} ride={r} showType={showType} />)}
                    </div>
                </div>
            )}

            <div>
                <h3 className="text-sm font-semibold text-gray-700 mb-3">All {activityNounPlural.charAt(0).toUpperCase() + activityNounPlural.slice(1)}</h3>
                <div className="border border-gray-200 rounded-xl divide-y divide-gray-100 overflow-hidden">
                    {rides.map(r => <RideRow key={r.id} ride={r} showType={showType} />)}
                </div>
            </div>
        </>
    );
}
