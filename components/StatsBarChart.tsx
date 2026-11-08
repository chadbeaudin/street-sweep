'use client';

import { useState } from 'react';
import { useUnits } from './UnitsContext';
import { distanceFromMiles, distanceUnit } from '@/lib/units';

export interface StatsBar {
    key: number;
    label: string;
    tooltipTitle: string;
    miles: number; // outdoor only; virtual stacks underneath
    rides: number;
    type?: { mountainMiles: number; roadGravelMiles: number };
    virtual?: { miles: number; rides: number };
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
        ? [{ series: SERIES.mountain, miles: b.type.mountainMiles, testId: `mtb-bar-${b.key}` }, { series: SERIES.roadGravel, miles: b.type.roadGravelMiles }]
        : [{ series: SERIES.outdoor, miles: b.miles }];
    return b.virtual?.miles ? [{ series: SERIES.virtual, miles: b.virtual.miles, testId: `virtual-bar-${b.key}` }, ...outdoor] : outdoor;
}

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
    const maxMiles = Math.max(...bars.map(totalOf), 1);
    const legend = bars.some(b => b.virtual?.miles) ? [SERIES.virtual, ...(bars.some(b => b.type) ? [SERIES.mountain, SERIES.roadGravel] : [SERIES.outdoor])] : [];

    return (
        <div className="bg-gray-50 border border-gray-100 rounded-xl p-3">
            <div className="flex items-center justify-between gap-2 mb-2">
                <div className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider">{title}</div>
                {legend.length > 0 && (
                    <div className="flex items-center gap-2.5 text-[10px] text-gray-500">
                        {legend.map(s => <span key={s.label} className="inline-flex items-center gap-1"><span className={`w-2 h-2 rounded-sm ${s.color}`} />{s.label}</span>)}
                    </div>
                )}
            </div>
            <div className="flex gap-1.5 h-24">
                {bars.map((b, i) => {
                    const align = i < 2 ? 'left-0' : i > bars.length - 3 ? 'right-0' : 'left-1/2 -translate-x-1/2';
                    const total = totalOf(b);
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
                            className={`relative flex-1 flex flex-col items-center gap-1 min-w-0 ${selectable ? 'cursor-pointer' : ''}`}
                            onMouseEnter={() => setHovered(b.key)}
                            onMouseLeave={() => setHovered(null)}
                            {...selectProps}
                        >
                            {hovered === b.key && (
                                <div role="tooltip" className={`absolute bottom-full mb-1 z-10 ${align} whitespace-nowrap rounded-lg bg-gray-900 text-white text-[11px] px-2.5 py-1.5 shadow-lg pointer-events-none`}>
                                    <div className="font-semibold">{b.tooltipTitle}</div>
                                    <div className="tabular-nums text-gray-300">{formatDist(total)} · {b.rides + (b.virtual?.rides ?? 0)} {activityNounPlural}</div>
                                    {(b.type || b.virtual?.miles) && segmentsOf(b).map(seg => (
                                        <div key={seg.series.label} className="flex items-center gap-1.5 tabular-nums"><span className={`w-2 h-2 rounded-sm ${seg.series.color}`} />{seg.series.label} {formatDist(seg.miles)}</div>
                                    ))}
                                </div>
                            )}
                            <div className="w-full flex-1 flex items-end">
                                {total > 0 && (
                                    <div className="w-full rounded-t overflow-hidden flex flex-col-reverse hover:opacity-90 transition-opacity" style={{ height: `${Math.max(3, (total / maxMiles) * 100)}%` }}>
                                        {segmentsOf(b).map(seg => (
                                            <div key={seg.series.label} data-testid={seg.testId} className={`w-full ${seg.series.color}`} style={{ height: `${(seg.miles / total) * 100}%` }} />
                                        ))}
                                    </div>
                                )}
                            </div>
                            <span className="text-[9px] text-gray-500 tabular-nums">{b.label}</span>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
