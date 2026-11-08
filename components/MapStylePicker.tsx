'use client';

import { Layers } from 'lucide-react';
import { useMapStyle } from './MapStyleContext';
import { MAP_STYLES } from '@/lib/mapStyles';

export function MapStylePicker() {
    const { style, setStyleId } = useMapStyle();
    return (
        <label className="flex items-center gap-1.5 h-9 pl-2.5 pr-1 bg-white rounded shadow-md border border-gray-300 text-gray-700">
            <Layers size={16} className="flex-shrink-0" aria-hidden />
            <select
                aria-label="Map style"
                value={style.id}
                onChange={e => setStyleId(e.target.value)}
                className="bg-transparent text-sm font-medium text-gray-700 pr-1 cursor-pointer focus:outline-none"
            >
                {MAP_STYLES.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
        </label>
    );
}
