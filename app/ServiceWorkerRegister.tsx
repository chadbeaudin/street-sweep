'use client';
import { useEffect } from 'react';

export default function ServiceWorkerRegister() {
    useEffect(() => {
        if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;
        // sw.js serves static files cache-first. Dev chunk URLs never change between
        // builds, so a registered worker would keep serving stale app code forever.
        if (process.env.NODE_ENV !== 'production') {
            navigator.serviceWorker.getRegistrations()
                .then((regs) => Promise.all(regs.map((r) => r.unregister())))
                .catch(() => { /* non-fatal */ });
            return;
        }
        const onLoad = () => navigator.serviceWorker.register('/sw.js').catch(() => { /* non-fatal */ });
        window.addEventListener('load', onLoad);
        return () => window.removeEventListener('load', onLoad);
    }, []);
    return null;
}
