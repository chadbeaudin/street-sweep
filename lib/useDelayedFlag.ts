import { useEffect, useState } from 'react';

// True only once `active` has stayed true for `delayMs`; false again as soon as it isn't.
// Keeps a progress indicator from flashing for work that finishes almost immediately.
export function useDelayedFlag(active: boolean, delayMs: number): boolean {
    const [shown, setShown] = useState(false);
    useEffect(() => {
        if (!active) { setShown(false); return; }
        const timer = setTimeout(() => setShown(true), delayMs);
        return () => clearTimeout(timer);
    }, [active, delayMs]);
    return active && shown;
}
