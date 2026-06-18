const DB_NAME = 'streetsweep';
const STORE_NAME = 'strava_cache';
const CACHE_KEY = 'ridden_roads';
const TTL_MS = 24 * 60 * 60 * 1000;

interface CacheEntry {
    data: [number, number][][];
    elevations?: number[];
    types?: string[];
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
                { data, elevations, types, cachedAt: Date.now(), credentialsKey } satisfies CacheEntry,
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
