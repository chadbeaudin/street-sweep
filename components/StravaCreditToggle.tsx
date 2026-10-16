'use client';

import { useEffect, useState } from 'react';
import { signIn } from 'next-auth/react';
import { Check } from 'lucide-react';

interface CreditSettings {
    hasStravaAccount: boolean;
    creditRoutesOnStrava: boolean;
    canWriteToStrava: boolean;
}

export function StravaCreditToggle({ className = '' }: { className?: string }) {
    const [settings, setSettings] = useState<CreditSettings | null>(null);

    useEffect(() => {
        fetch('/api/account').then(r => r.ok ? r.json() : null).then(setSettings).catch(() => {});
    }, []);

    if (!settings?.hasStravaAccount) return null;

    const itemClass = `w-full text-left px-4 py-2.5 min-h-[44px] text-sm text-gray-700 hover:bg-gray-100 flex items-center gap-2 ${className}`;

    if (!settings.canWriteToStrava) {
        return (
            <button
                onClick={() => signIn('strava')}
                className={itemClass}
                title="Reconnect Strava and allow activity updates so rides that follow your routes can be credited"
            >
                Reconnect Strava to credit rides
            </button>
        );
    }

    const toggle = async () => {
        const previous = settings;
        const creditRoutesOnStrava = !settings.creditRoutesOnStrava;
        setSettings({ ...settings, creditRoutesOnStrava });
        const res = await fetch('/api/account', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ creditRoutesOnStrava }),
        }).catch(() => null);
        if (!res?.ok) setSettings(previous);
    };

    return (
        <button
            onClick={toggle}
            className={itemClass}
            title='Adds "Route created by StreetSweep" to the description of a Strava ride that follows a route you exported'
        >
            <span className={`w-4 h-4 shrink-0 rounded border flex items-center justify-center ${settings.creditRoutesOnStrava ? 'bg-indigo-600 border-indigo-600' : 'border-gray-400'}`}>
                {settings.creditRoutesOnStrava && <Check className="w-3 h-3 text-white" />}
            </span>
            Credit StreetSweep on Strava rides
        </button>
    );
}
