'use client';
import { useEffect } from 'react';

export default function ServiceWorkerRegister() {
    useEffect(() => {
        if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;
        const onLoad = () => navigator.serviceWorker.register('/sw.js').catch(() => { /* non-fatal */ });
        window.addEventListener('load', onLoad);
        return () => window.removeEventListener('load', onLoad);
    }, []);
    return null;
}
