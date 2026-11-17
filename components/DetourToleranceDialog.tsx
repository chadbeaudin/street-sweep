'use client';

import { useState, useEffect } from 'react';
import { X, Check } from 'lucide-react';
import { useUnits } from '@/components/UnitsContext';

interface DetourToleranceDialogProps {
    isOpen: boolean;
    initialMeters: number;
    onClose: () => void;
    onConfirm: (meters: number) => void;
}

export const MAX_DETOUR_M = 500;

export function formatDetour(meters: number, units: 'imperial' | 'metric'): string {
    return units === 'imperial' ? `${Math.round(meters * 3.28084 / 10) * 10} ft` : `${meters} m`;
}

export function DetourToleranceDialog({ isOpen, initialMeters, onClose, onConfirm }: DetourToleranceDialogProps) {
    const { units } = useUnits();
    const [meters, setMeters] = useState(initialMeters);

    useEffect(() => {
        if (isOpen) setMeters(initialMeters);
    }, [isOpen, initialMeters]);

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[2000] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm flex flex-col overflow-hidden">
                <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between bg-gray-50/50">
                    <h2 className="text-lg font-bold text-gray-900">Optimize Imported Route</h2>
                    <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-full transition-colors text-gray-500">
                        <X className="w-5 h-5" />
                    </button>
                </div>
                <div className="p-6 space-y-3">
                    <label className="text-sm font-semibold text-gray-700 flex items-center justify-between">
                        <span>Detour tolerance</span>
                        <span className="text-indigo-600">{formatDetour(meters, units)}</span>
                    </label>
                    <input
                        type="range"
                        min={0}
                        max={MAX_DETOUR_M}
                        step={25}
                        value={meters}
                        onChange={(e) => setMeters(parseInt(e.target.value))}
                        className="w-full"
                        autoFocus
                    />
                    <p className="text-xs text-gray-500">How far off the imported route to stray for streets you haven&apos;t ridden. Low keeps it on parallel streets; high allows real detours.</p>
                </div>
                <div className="px-6 py-4 border-t border-gray-100 flex items-center justify-end gap-3 bg-gray-50/50">
                    <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">
                        Cancel
                    </button>
                    <button
                        onClick={() => onConfirm(meters)}
                        className="flex items-center gap-2 px-6 py-2 bg-indigo-600 text-white rounded-lg text-sm font-bold hover:bg-indigo-700 transition-colors"
                    >
                        <Check className="w-4 h-4" /> Optimize
                    </button>
                </div>
            </div>
        </div>
    );
}
