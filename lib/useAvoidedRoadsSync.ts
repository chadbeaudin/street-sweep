import { useEffect, useRef } from 'react';

type Roads = [number, number][][];

// Keeps a signed-in user's avoided roads (#45) on their account (#150). On
// sign-in the account copy wins; if the account has none yet, this browser's
// localStorage roads are uploaded so nothing marked before #150 is lost. After
// that, every add/delete/clear is saved. Signed-out users keep localStorage only.
export function useAvoidedRoadsSync(sessionStatus: string, avoidedRoads: Roads, setAvoidedRoads: (roads: Roads) => void) {
    const syncedRef = useRef<string | null>(null);
    const currentRef = useRef(avoidedRoads);
    currentRef.current = avoidedRoads;

    useEffect(() => {
        if (sessionStatus !== 'authenticated') {
            syncedRef.current = null;
            return;
        }
        let cancelled = false;
        fetch('/api/avoided-roads')
            .then(r => (r.ok ? r.json() as Promise<{ roads: Roads }> : null))
            .then(data => {
                if (cancelled || !data) return;
                if (data.roads.length > 0) {
                    syncedRef.current = JSON.stringify(data.roads);
                    setAvoidedRoads(data.roads);
                } else {
                    syncedRef.current = JSON.stringify([]);
                    if (currentRef.current.length > 0) save(currentRef.current, syncedRef);
                }
            })
            .catch(() => { /* stay on localStorage until the next sign-in */ });
        return () => { cancelled = true; };
    }, [sessionStatus, setAvoidedRoads]);

    useEffect(() => {
        if (syncedRef.current === null || syncedRef.current === JSON.stringify(avoidedRoads)) return;
        save(avoidedRoads, syncedRef);
    }, [avoidedRoads]);
}

function save(roads: Roads, syncedRef: { current: string | null }) {
    syncedRef.current = JSON.stringify(roads);
    fetch('/api/avoided-roads', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roads }),
    }).catch(() => { /* kept in localStorage; next change retries */ });
}
