'use client';

import { useTheme } from './ThemeContext';
import type { ThemePreference } from '@/lib/theme';

const OPTIONS: { value: ThemePreference; label: string }[] = [
    { value: 'light', label: 'Light' },
    { value: 'dark', label: 'Dark' },
    { value: 'system', label: 'System' },
];

export function ThemeToggle() {
    const { preference, setPreference } = useTheme();
    return (
        <div role="radiogroup" aria-label="Theme" className="flex rounded-md border border-gray-300 overflow-hidden text-sm">
            {OPTIONS.map((o, i) => (
                <button
                    key={o.value}
                    role="radio"
                    aria-checked={preference === o.value}
                    onClick={() => setPreference(o.value)}
                    className={`flex-1 px-3 py-1.5 transition-colors ${i > 0 ? 'border-l border-gray-300' : ''} ${preference === o.value ? 'bg-indigo-600 text-white' : 'text-gray-700 hover:bg-gray-50'}`}
                >
                    {o.label}
                </button>
            ))}
        </div>
    );
}
