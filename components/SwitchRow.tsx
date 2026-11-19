'use client';

interface SwitchRowProps {
    label: string;
    checked: boolean;
    onChange: (checked: boolean) => void;
}

// An on/off setting that reads as a switch, not a bullet point (#249).
export function SwitchRow({ label, checked, onChange }: SwitchRowProps) {
    return (
        <button
            type="button"
            role="switch"
            aria-checked={checked}
            onClick={() => onChange(!checked)}
            className="w-full px-3 py-2 text-sm rounded-md flex items-center justify-between text-gray-700 hover:bg-gray-100 transition-colors"
        >
            <span>{label}</span>
            <span className={`relative inline-flex h-5 w-9 shrink-0 rounded-full transition-colors ${checked ? 'bg-indigo-600' : 'bg-gray-300'}`}>
                <span className={`absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-4' : ''}`} />
            </span>
        </button>
    );
}
