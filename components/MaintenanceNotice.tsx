'use client';

import { useEffect, useState } from 'react';
import { Wrench, X } from 'lucide-react';
import type { ServiceStatus } from '@/lib/serviceHealth';

// Tells visitors when the self-hosted backends are down (#129). The health
// check itself alerts the admin, so this only renders.
export function MaintenanceNotice() {
    const [services, setServices] = useState<ServiceStatus | null>(null);
    const [dismissed, setDismissed] = useState(false);

    useEffect(() => {
        fetch('/api/health', { cache: 'no-store' })
            .then(res => res.json())
            .then((data: { services?: ServiceStatus }) => setServices(data.services ?? null))
            .catch(() => {});
    }, []);

    if (!services) return null;

    if (!services.database) {
        return (
            <div role="alertdialog" aria-label="Down for maintenance" className="fixed inset-0 z-[3000] bg-gray-900/60 flex items-center justify-center p-4">
                <div className="bg-white rounded-xl shadow-2xl max-w-sm w-full p-6 text-center space-y-3">
                    <Wrench className="w-10 h-10 text-orange-500 mx-auto" />
                    <h2 className="text-lg font-bold text-gray-900">Down for maintenance</h2>
                    <p className="text-sm text-gray-600">
                        StreetSweep&apos;s backend services are down for maintenance. We&apos;ve been notified and will be back shortly.
                    </p>
                    <button onClick={() => window.location.reload()} className="px-4 py-2 bg-indigo-600 text-white rounded-md text-sm font-medium hover:bg-indigo-700">
                        Try again
                    </button>
                </div>
            </div>
        );
    }

    if (dismissed || (services.overpass && services.elevation)) return null;

    return (
        <div role="status" className="relative z-[1200] bg-orange-50 border-l-4 border-orange-400 px-6 py-3 flex items-center gap-3 shadow-sm">
            <Wrench className="w-5 h-5 text-orange-500 shrink-0" />
            <span className="text-sm font-medium text-orange-800 flex-1">
                Some backend services are down for maintenance. {!services.overpass && 'Loading roads and generating routes may be slower. '}
                {!services.elevation && 'Elevation data may be slower or unavailable.'}
            </span>
            <button onClick={() => setDismissed(true)} aria-label="Dismiss" className="text-orange-400 hover:text-orange-600 ml-2">
                <X className="w-4 h-4" />
            </button>
        </div>
    );
}
