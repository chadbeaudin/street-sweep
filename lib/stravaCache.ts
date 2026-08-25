const DB_NAME = 'streetsweep';
const STORE_NAME = 'strava_cache';
const CACHE_KEY = 'ridden_roads';
const TTL_MS = 24 * 60 * 60 * 1000;
// Separate cache entry for the server-precomputed, deduped ridden-road
// overlay (/api/ridden-roads) — this payload can run several MB for a rider
// with a lot of history, and the server itself only refreshes it on its own
// ~24h timer, so re-fetching it on every page load was pure wasted transfer
// (this endpoint had no client-side caching at all before). Its own key
// avoids colliding with the raw-activity cache above, which has a different
// shape and its own version/TTL lifecycle.
const PRECOMPUTED_CACHE_KEY = 'precomputed_ridden_roads';
const PRECOMPUTED_TTL_MS = 12 * 60 * 60 * 1000;
// Bump when the shape/semantics of cached rides change so stale entries are
// discarded. v2: rides are cycling-only (walks/hikes/runs excluded upstream).
// v3: virtual/indoor and stationary trainer rides also excluded.
const CACHE_VERSION = 3;

interface CacheEntry {
    data: [number, number][][];
    elevations?: number[];
    types?: string[];
    version?: number;
    cachedAt: number;
    credentialsKey: string;
}

export interface CachedActivities {
    roads: [number, number][][];
    elevations: number[];
    types: string[];
}

function openDB(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, 1);
        request.onupgradeneeded = (e) => {
            const db = (e.target as IDBOpenDBRequest).result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME);
            }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}
export async function getCachedRoads(credentialsKey: string): Promise<CachedActivities | null> {
    try {
        const db = await openDB();
        const entry = await new Promise<CacheEntry | undefined>((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readonly');
            const req = tx.objectStore(STORE_NAME).get(CACHE_KEY);
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
        if (!entry || entry.credentialsKey !== credentialsKey) return null;
        if (Date.now() - entry.cachedAt > TTL_MS) return null;
        // Entries written before the elevation field or type field was added are unusable.
        if (!entry.elevations || !entry.types) return null;
        // Entries from an older cache schema (e.g. pre-cycling-only) are discarded.
        if (entry.version !== CACHE_VERSION) return null;
        return { roads: entry.data, elevations: entry.elevations, types: entry.types };
    } catch {
        return null;
    }
}

export async function setCachedRoads(data: [number, number][][], elevations: number[], types: string[], credentialsKey: string): Promise<void> {
    try {
        const db = await openDB();
        await new Promise<void>((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readwrite');
            const req = tx.objectStore(STORE_NAME).put(
                { data, elevations, types, version: CACHE_VERSION, cachedAt: Date.now(), credentialsKey } satisfies CacheEntry,
                CACHE_KEY
            );
            req.onsuccess = () => resolve();
            req.onerror = () => reject(req.error);
        });
    } catch {
        // Caching is best-effort — silently ignore failures
    }
}
export async function clearCachedRoads(): Promise<void> {
    try {
        const db = await openDB();
        await new Promise<void>((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readwrite');
            const req = tx.objectStore(STORE_NAME).delete(CACHE_KEY);
            req.onsuccess = () => resolve();
            req.onerror = () => reject(req.error);
        });
    } catch {
        // Silently ignore
    }
}

interface PrecomputedCacheEntry {
    roads: [number, number][][];
    refreshedAt: string | null;
    cachedAt: number;
    credentialsKey: string;
}

export async function getCachedPrecomputedRoads(credentialsKey: string): Promise<[number, number][][] | null> {
    try {
        const db = await openDB();
        const entry = await new Promise<PrecomputedCacheEntry | undefined>((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readonly');
            const req = tx.objectStore(STORE_NAME).get(PRECOMPUTED_CACHE_KEY);
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
        if (!entry || entry.credentialsKey !== credentialsKey) return null;
        if (Date.now() - entry.cachedAt > PRECOMPUTED_TTL_MS) return null;
        return entry.roads;
    } catch {
        return null;
    }
}

export async function setCachedPrecomputedRoads(roads: [number, number][][], refreshedAt: string | null, credentialsKey: string): Promise<void> {
    try {
        const db = await openDB();
        await new Promise<void>((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readwrite');
            const req = tx.objectStore(STORE_NAME).put(
                { roads, refreshedAt, cachedAt: Date.now(), credentialsKey } satisfies PrecomputedCacheEntry,
                PRECOMPUTED_CACHE_KEY
            );
            req.onsuccess = () => resolve();
            req.onerror = () => reject(req.error);
        });
    } catch {
        // Caching is best-effort — silently ignore failures
    }
}

export async function clearCachedPrecomputedRoads(): Promise<void> {
    try {
        const db = await openDB();
        await new Promise<void>((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readwrite');
            const req = tx.objectStore(STORE_NAME).delete(PRECOMPUTED_CACHE_KEY);
            req.onsuccess = () => resolve();
            req.onerror = () => reject(req.error);
        });
    } catch {
        // Silently ignore
    }
}
