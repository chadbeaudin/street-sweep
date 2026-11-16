'use client';

import { useEffect, useState } from 'react';
import { useUnits } from './UnitsContext';
import { distanceFromMiles, distanceUnit } from '@/lib/units';
import { formatHours } from '@/lib/stats';

export interface StatsBar {
    key: number;
    label: string;
    tooltipTitle: string;
    miles: number; // outdoor only; virtual stacks underneath
    rides: number;
    hours?: number; // outdoor moving time; drawn as a line over the bars (#230)
    type?: { mountainMiles: number; roadGravelMiles: number; mountainHours?: number; roadGravelHours?: number };
    virtual?: { miles: number; rides: number; hours?: number };
}

const SERIES = {
    mountain: { label: 'Mountain Bike', color: 'bg-emerald-500' },
    roadGravel: { label: 'Road / Gravel', color: 'bg-indigo-400' },
    outdoor: { label: 'Outdoor', color: 'bg-indigo-400' },
    virtual: { label: 'Virtual', color: 'bg-orange-400' },
};

// Bottom to top.
function segmentsOf(b: StatsBar) {
    const outdoor = b.type
        ? [{ series: SERIES.mountain, miles: b.type.mountainMiles, hours: b.type.mountainHours, testId: `mtb-bar-${b.key}` }, { series: SERIES.roadGravel, miles: b.type.roadGravelMiles, hours: b.type.roadGravelHours }]
        : [{ series: SERIES.outdoor, miles: b.miles, hours: b.hours }];
    return b.virtual?.miles ? [{ series: SERIES.virtual, miles: b.virtual.miles, hours: b.virtual.hours, testId: `virtual-bar-${b.key}` }, ...outdoor] : outdoor;
}

// Which measure the bars show; the other one is drawn as the line (#230).
type BarMetric = 'distance' | 'time';
const BAR_METRIC_KEY = 'stats_bar_metric';

interface StatsBarChartProps {
    title: string;
    bars: StatsBar[];
    activityNounPlural: string;
    onSelect?: (key: number) => void; // empty bars aren't selectable
}

export function StatsBarChart({ title, bars, activityNounPlural, onSelect }: StatsBarChartProps) {
    const { units } = useUnits();
    const [hovered, setHovered] = useState<number | null>(null);
    const formatDist = (miles: number) => `${Math.round(distanceFromMiles(miles, units)).toLocaleString()} ${distanceUnit(units)}`;
    const totalOf = (b: StatsBar) => b.miles + (b.virtual?.miles ?? 0);
    // Absent for stats computed before moving time was tracked.
    const showHours = bars.some(b => b.hours !== undefined);
    const hoursOf = (b: StatsBar) => (b.hours ?? 0) + (b.virtual?.hours ?? 0);

    const [chosenMetric, setChosenMetric] = useState<BarMetric>('distance');
    useEffect(() => {
        try { if (localStorage.getItem(BAR_METRIC_KEY) === 'time') setChosenMetric('time'); } catch { /* storage unavailable */ }
    }, []);
    const chooseMetric = (metric: BarMetric) => {
        setChosenMetric(metric);
        try { localStorage.setItem(BAR_METRIC_KEY, metric); } catch { /* storage unavailable */ }
    };
    const barsShowTime = showHours && chosenMetric === 'time';
    const barValueOf = (b: StatsBar) => (barsShowTime ? hoursOf(b) : totalOf(b));
    const lineValueOf = (b: StatsBar) => (barsShowTime ? totalOf(b) : hoursOf(b));
    const segmentValue = (seg: { miles: number; hours?: number }) => (barsShowTime ? seg.hours ?? 0 : seg.miles);

    // The line is drawn at the bar value it matches at the chart's average speed, so a point
    // above its bar means more of the line's measure than usual for that bar, and below, less.
    const barTotal = bars.reduce((sum, b) => sum + barValueOf(b), 0);
    const lineTotal = bars.reduce((sum, b) => sum + lineValueOf(b), 0);
    const barPerLine = lineTotal > 0 ? barTotal / lineTotal : 0;
    const maxValue = Math.max(...bars.map(b => Math.max(barValueOf(b), lineValueOf(b) * barPerLine)), 1);
    // Bars are equal-width columns, so bar i is centred at (i + 0.5) / n of the width.
    const linePoints = bars.map((b, i) => ({ key: b.key, x: ((i + 0.5) / bars.length) * 100, y: ((lineValueOf(b) * barPerLine) / maxValue) * 100 }));
    const lineLabel = barsShowTime ? (units === 'metric' ? 'Kilometers' : 'Miles') : 'Hours';
    const seriesLegend = bars.some(b => b.virtual?.miles) ? [SERIES.virtual, ...(bars.some(b => b.type) ? [SERIES.mountain, SERIES.roadGravel] : [SERIES.outdoor])] : [];

    return (
        <div className="bg-gray-50 border border-gray-100 rounded-xl p-3">
            <div className="flex items-center justify-between gap-2 mb-2">
                <div className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider">{title}</div>
                {showHours && (
                    <div className="inline-flex rounded-md border border-gray-200 overflow-hidden text-[10px] font-medium" role="group" aria-label="What the bars show">
                        {([['distance', 'Distance'], ['time', 'Time']] as const).map(([metric, label]) => (
                            <button
                                key={metric}
                                type="button"
                                aria-pressed={chosenMetric === metric}
                                onClick={() => chooseMetric(metric)}
                                className={`px-2 py-0.5 transition-colors ${chosenMetric === metric ? 'bg-indigo-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-100'}`}
                            >
                                {label}
                            </button>
                        ))}
                    </div>
                )}
            </div>
            {(seriesLegend.length > 0 || showHours) && (
                <div className="flex items-center justify-end gap-2.5 text-[10px] text-gray-500 mb-2">
                    {seriesLegend.map(s => <span key={s.label} className="inline-flex items-center gap-1"><span className={`w-2 h-2 rounded-sm ${s.color}`} />{s.label}</span>)}
                    {showHours && <span className="inline-flex items-center gap-1" title={`Above a bar: more ${lineLabel.toLowerCase()} than usual for that bar. Below: fewer.`}><span className="w-3 h-0.5 bg-gray-800" />{lineLabel}</span>}
                </div>
            )}
            <div className="relative flex h-24">
                {bars.map((b, i) => {
                    const align = i < 2 ? 'left-0' : i > bars.length - 3 ? 'right-0' : 'left-1/2 -translate-x-1/2';
                    const total = totalOf(b);
                    const barValue = barValueOf(b);
                    const selectable = onSelect && b.miles > 0;
                    const selectProps = selectable ? {
                        role: 'button',
                        tabIndex: 0,
                        'aria-label': `View ${b.tooltipTitle} details`,
                        onClick: () => onSelect(b.key),
                        onKeyDown: (e: React.KeyboardEvent) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(b.key); } },
                    } : {};
                    return (
                        <div
                            key={b.key}
                            className={`relative flex-1 flex flex-col items-center gap-1 min-w-0 px-[3px] ${selectable ? 'cursor-pointer' : ''}`}
                            onMouseEnter={() => setHovered(b.key)}
                            onMouseLeave={() => setHovered(null)}
                            {...selectProps}
                        >
                            {hovered === b.key && (
                                <div role="tooltip" className={`absolute bottom-full mb-1 z-10 ${align} whitespace-nowrap rounded-lg bg-gray-900 text-white text-[11px] px-2.5 py-1.5 shadow-lg pointer-events-none`}>
                                    <div className="font-semibold">{b.tooltipTitle}</div>
                                    <div className="tabular-nums text-gray-300">{formatDist(total)}{showHours && ` · ${formatHours(hoursOf(b))}`} · {b.rides + (b.virtual?.rides ?? 0)} {activityNounPlural}</div>
                                    {(b.type || b.virtual?.miles) && segmentsOf(b).map(seg => (
                                        <div key={seg.series.label} className="flex items-center gap-1.5 tabular-nums"><span className={`w-2 h-2 rounded-sm ${seg.series.color}`} />{seg.series.label} {formatDist(seg.miles)}{seg.hours !== undefined && ` · ${formatHours(seg.hours)}`}</div>
                                    ))}
                                </div>
                            )}
                            <div className="w-full flex-1 flex items-end">
                                {barValue > 0 && (
                                    <div className="w-full rounded-t overflow-hidden flex flex-col-reverse hover:opacity-90 transition-opacity" style={{ height: `${Math.max(3, (barValue / maxValue) * 100)}%` }}>
                                        {segmentsOf(b).map(seg => (
                                            <div key={seg.series.label} data-testid={seg.testId} className={`w-full ${seg.series.color}`} style={{ height: `${(segmentValue(seg) / barValue) * 100}%` }} />
                                        ))}
                                    </div>
                                )}
                            </div>
                            <span className="h-3 leading-3 text-[9px] text-gray-500 tabular-nums">{b.label}</span>
                        </div>
                    );
                })}
                {/* Sits above the labels (h-3 + gap-1). */}
                {showHours && (
                    <div className="absolute inset-x-0 top-0 bottom-4 pointer-events-none" aria-hidden="true">
                        <svg className="absolute inset-0 w-full h-full overflow-visible" viewBox="0 0 100 100" preserveAspectRatio="none">
                            <polyline points={linePoints.map(p => `${p.x},${100 - p.y}`).join(' ')} fill="none" stroke="#1f2937" strokeWidth="1.5" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
                        </svg>
                        {linePoints.map(p => (
                            <span key={p.key} data-testid={`line-point-${p.key}`} className="absolute w-1.5 h-1.5 rounded-full bg-gray-800 ring-1 ring-white -translate-x-1/2 translate-y-1/2" style={{ left: `${p.x}%`, bottom: `${p.y}%` }} />
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
