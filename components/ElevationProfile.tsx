'use client';

import React, { useMemo } from 'react';
import {
    AreaChart,
    Area,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    ResponsiveContainer,
    ReferenceLine
} from 'recharts';

interface ElevationData {
    distance: number;
    elevation: number;
    lat: number;
    lon: number;
}

interface ElevationProfileProps {
    data: ElevationData[];
    onHover: (point: { lat: number; lon: number } | null) => void;
}

export const ElevationProfile: React.FC<ElevationProfileProps> = ({ data, onHover }) => {
    if (!data || data.length === 0) return null;

    // Find min/max for better Y axis scaling
    const elevations = data.map(d => d.elevation);
    const minElev = Math.min(...elevations);
    const maxElev = Math.max(...elevations);

    // Padding for Y axis
    const yDomain = [
        Math.floor(minElev / 100) * 100 - 100,
        Math.ceil(maxElev / 100) * 100 + 100
    ];

    return (
        <div className="w-full h-48 bg-white border-t border-gray-200 p-4 shadow-inner relative z-10">
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Elevation Profile (feet)</h3>
            <div className="w-full h-32">
                <ResponsiveContainer width="100%" height="100%">
                    <AreaChart
                        data={data}
                        margin={{ top: 5, right: 20, left: 10, bottom: 0 }}
                        onMouseMove={(state: any) => {
                            if (state && state.activePayload && state.activePayload.length > 0) {
                                const point = state.activePayload[0].payload;
                                onHover({ lat: point.lat, lon: point.lon });
                            }
                        }}
                        onMouseLeave={() => onHover(null)}
                    >
                        <defs>
                            <linearGradient id="colorElev" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor="#8884d8" stopOpacity={0.1} />
                                <stop offset="95%" stopColor="#8884d8" stopOpacity={0} />
                            </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E5E7EB" />
                        <XAxis
                            dataKey="distance"
                            tickFormatter={(val) => `${val} mi`}
                            fontSize={10}
                            tick={{ fill: '#9CA3AF' }}
                            axisLine={{ stroke: '#E5E7EB' }}
                            tickLine={false}
                            interval="preserveStartEnd"
                        />
                        <YAxis
                            domain={yDomain}
                            fontSize={10}
                            tick={{ fill: '#9CA3AF' }}
                            axisLine={false}
                            tickLine={false}
                            tickFormatter={(val) => `${val}`}
                        />
                        <Tooltip
                            contentStyle={{ fontSize: '12px', borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                            labelFormatter={(val) => `${val} miles`}
                            formatter={(val: any) => [`${val} ft`, 'Elevation']}
                        />
                        <Area
                            type="monotone"
                            dataKey="elevation"
                            stroke="#8884d8"
                            fillOpacity={1}
                            fill="url(#colorElev)"
                            strokeWidth={2}
                            activeDot={{ r: 4, strokeWidth: 0, fill: '#6366F1' }}
                        />
                    </AreaChart>
                </ResponsiveContainer>
            </div>
        </div>
    );
};
