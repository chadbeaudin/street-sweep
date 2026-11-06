'use client';

import { useState } from 'react';
import { useUnits } from './UnitsContext';
import { distanceFromMiles, distanceUnit } from '@/lib/units';

export interface StatsBar {
    key: number;
    label: string;
    tooltipTitle: string;
    miles: number;
    rides: number;
    type?: { mountainMiles: number; roadGravelMiles: number };
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
    const maxMiles = Math.max(...bars.map(b => b.miles), 1);

    return (
        <div className="bg-gray-50 border border-gray-100 rounded-xl p-3">
            <div className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-2">{title}</div>
            <div className="flex gap-1.5 h-24">
                {bars.map((b, i) => {
                    const align = i < 2 ? 'left-0' : i > bars.length - 3 ? 'right-0' : 'left-1/2 -translate-x-1/2';
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
                                    <div className="tabular-nums text-gray-300">{formatDist(b.miles)} · {b.rides} {activityNounPlural}</div>
                                    {b.type && (
                                        <>
                                            <div className="flex items-center gap-1.5 tabular-nums"><span className="w-2 h-2 rounded-sm bg-emerald-500" />Mountain Bike {formatDist(b.type.mountainMiles)}</div>
                                            <div className="flex items-center gap-1.5 tabular-nums"><span className="w-2 h-2 rounded-sm bg-indigo-400" />Road / Gravel {formatDist(b.type.roadGravelMiles)}</div>
                                        </>
                                    )}
                                </div>
                            )}
                            <div className="w-full flex-1 flex items-end">
                                {b.miles > 0 && (
                                    <div className="w-full rounded-t overflow-hidden flex flex-col-reverse bg-indigo-400 hover:opacity-90 transition-opacity" style={{ height: `${Math.max(3, (b.miles / maxMiles) * 100)}%` }}>
                                        {b.type && (
                                            <div data-testid={`mtb-bar-${b.key}`} className="w-full bg-emerald-500" style={{ height: `${(b.type.mountainMiles / b.miles) * 100}%` }} />
                                        )}
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
