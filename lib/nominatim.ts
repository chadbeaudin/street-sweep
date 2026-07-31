const NOMINATIM_BASE = 'https://nominatim.openstreetmap.org';
const USER_AGENT = 'StreetSweep/1.0 (https://github.com/chadbeaudin/street-sweep)';
const MIN_GAP_MS = 1100; // Nominatim TOS: max 1 req/sec
const FETCH_TIMEOUT_MS = 8000;
const CACHE_TTL = 1000 * 60 * 60 * 24 * 30; // 30 days

// Mutex chain: each rate-limited fetch awaits the previous slot's release
// before its own fires. A naive `await sleep(gap)` based on a shared
// lastRequestAt is racy — many parallel callers compute the same `gap`,
// all sleep the same amount, all fire together, and Nominatim blanket-429s.
let rateLimitChain: Promise<void> = Promise.resolve();
async function rateLimit(): Promise<void> {
    const myTurn = rateLimitChain;
    rateLimitChain = (async () => {
        await myTurn;
        await new Promise<void>(r => setTimeout(r, MIN_GAP_MS));
    })();
    await myTurn;
}

async function fetchWithTimeout(url: string, init?: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
        return await fetch(url, { ...init, signal: controller.signal });
    } finally {
        clearTimeout(timer);
    }
}

interface ReverseResult {
    city: string | null;
    county: string | null;
    state: string | null;
    country: string | null;
}

interface CityPolygon {
    name: string;
    polygon: [number, number][]; // [[lat, lon], ...]
    bbox: { south: number; west: number; north: number; east: number };
}

const REVERSE_CACHE = new Map<string, ReverseResult>();
const POLYGON_CACHE = new Map<string, CityPolygon | null>();

// Quantize lat/lon to ~5km grid so nearby activity centroids share a single
// reverse-geocode lookup. City attribution at this resolution is plenty accurate
// and keeps Nominatim's 1-req/sec limit from dominating the stats endpoint.
function reverseKey(lat: number, lon: number): string {
    return `${Math.round(lat * 20) / 20}:${Math.round(lon * 20) / 20}`;
}

export async function reverseGeocode(lat: number, lon: number): Promise<ReverseResult> {
    const key = reverseKey(lat, lon);
    const cached = REVERSE_CACHE.get(key);
    if (cached) return cached;

    await rateLimit();
    const url = `${NOMINATIM_BASE}/reverse?lat=${lat}&lon=${lon}&format=json&zoom=10&addressdetails=1`;
    try {
        const res = await fetchWithTimeout(url, { headers: { 'User-Agent': USER_AGENT } });

        if (!res.ok) {
            // Don't cache 429 — we want to retry on the next request after backoff.
            // Other 4xx/5xx are typically permanent (bad coord, etc) — cache empty.
            if (res.status !== 429) {
                const empty: ReverseResult = { city: null, county: null, state: null, country: null };
                REVERSE_CACHE.set(key, empty);
                return empty;
            }
            throw new Error(`Nominatim 429 (rate-limited)`);
        }
        const data = await res.json();
        const addr = data.address || {};
        const result: ReverseResult = {
            city: addr.city || addr.town || addr.village || addr.hamlet || addr.municipality || null,
            county: addr.county || addr.district || null,
            state: addr.state || addr.region || null,
            country: addr.country || null
        };
        REVERSE_CACHE.set(key, result);
        return result;
    } catch (e: any) {
        // Don't cache transient errors (timeouts, 429s) — but propagate so the
        // caller can stop hammering rather than logging once per failed bucket.
        throw e;
    }
}

export async function searchCityPolygon(name: string, state: string | null, country: string | null): Promise<CityPolygon | null> {
    const qParts = [name, state, country].filter(Boolean) as string[];
    const cacheKey = qParts.join('|').toLowerCase();
    if (POLYGON_CACHE.has(cacheKey)) return POLYGON_CACHE.get(cacheKey) ?? null;

    await rateLimit();
    const q = encodeURIComponent(qParts.join(', '));
    const url = `${NOMINATIM_BASE}/search?q=${q}&format=json&polygon_geojson=1&limit=1&featuretype=city`;
    const res = await fetchWithTimeout(url, { headers: { 'User-Agent': USER_AGENT } });
    if (!res.ok) {
        if (res.status === 429) throw new Error('Nominatim 429 (rate-limited)');
        POLYGON_CACHE.set(cacheKey, null);
        return null;
    }
    const arr = await res.json();
    if (!arr || arr.length === 0) { POLYGON_CACHE.set(cacheKey, null); return null; }
    const top = arr[0];
    const bb = top.boundingbox; // [south, north, west, east] as strings
    const bbox = {
        south: parseFloat(bb[0]),
        north: parseFloat(bb[1]),
        west: parseFloat(bb[2]),
        east: parseFloat(bb[3])
    };
    const geom = top.geojson;
    let polygon: [number, number][] = [];
    if (geom?.type === 'Polygon') {
        polygon = geom.coordinates[0].map((p: [number, number]) => [p[1], p[0]] as [number, number]);
    } else if (geom?.type === 'MultiPolygon') {
        // Use the largest ring by vertex count as a reasonable approximation
        let best: [number, number][] = [];
        for (const poly of geom.coordinates) {
            const ring = poly[0];
            if (ring.length > best.length) best = ring;
        }
        polygon = best.map((p: [number, number]) => [p[1], p[0]] as [number, number]);
    } else {
        // No polygon available — fall back to bbox corners
        polygon = [
            [bbox.south, bbox.west],
            [bbox.south, bbox.east],
            [bbox.north, bbox.east],
            [bbox.north, bbox.west],
            [bbox.south, bbox.west]
        ];
    }
    const result: CityPolygon = { name, polygon, bbox };
    POLYGON_CACHE.set(cacheKey, result);
    return result;
}
