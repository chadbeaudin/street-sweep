import { useEffect, useRef } from 'react';

type Roads = [number, number][][];

// Keeps a signed-in user's marked roads -- avoided (#45) or preferred (#46) -- on
// their account (#150), via `endpoint`. On sign-in the account copy wins; if the
// account has none yet, this browser's localStorage roads are uploaded so nothing
// marked before #150 is lost. After that, every add/delete/clear is saved.
// Signed-out users keep localStorage only.
export function useMarkedRoadsSync(endpoint: string, sessionStatus: string, roads: Roads, setRoads: (roads: Roads) => void) {
    const syncedRef = useRef<string | null>(null);
    const currentRef = useRef(roads);
    currentRef.current = roads;

    useEffect(() => {
        if (sessionStatus !== 'authenticated') {
            syncedRef.current = null;
            return;
        }
        let cancelled = false;
        fetch(endpoint)
            .then(r => (r.ok ? r.json() as Promise<{ roads: Roads }> : null))
            .then(data => {
                if (cancelled || !data) return;
                if (data.roads.length > 0) {
                    syncedRef.current = JSON.stringify(data.roads);
                    setRoads(data.roads);
                } else {
                    syncedRef.current = JSON.stringify([]);
                    if (currentRef.current.length > 0) save(endpoint, currentRef.current, syncedRef);
                }
            })
            .catch(() => { /* stay on localStorage until the next sign-in */ });
        return () => { cancelled = true; };
    }, [endpoint, sessionStatus, setRoads]);

    useEffect(() => {
        if (syncedRef.current === null || syncedRef.current === JSON.stringify(roads)) return;
        save(endpoint, roads, syncedRef);
    }, [endpoint, roads]);
}

function save(endpoint: string, roads: Roads, syncedRef: { current: string | null }) {
    syncedRef.current = JSON.stringify(roads);
    fetch(endpoint, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roads }),
    }).catch(() => { /* kept in localStorage; next change retries */ });
}
