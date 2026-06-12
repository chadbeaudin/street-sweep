const NOMINATIM_BASE = 'https://nominatim.openstreetmap.org';
const USER_AGENT = 'StreetSweep/1.0 (https://github.com/chadbeaudin/street-sweep)';
const MIN_GAP_MS = 1100; // Nominatim TOS: max 1 req/sec
const CACHE_TTL = 1000 * 60 * 60 * 24 * 30; // 30 days

let lastRequestAt = 0;
async function rateLimit(): Promise<void> {
    const gap = Date.now() - lastRequestAt;
    if (gap < MIN_GAP_MS) await new Promise(r => setTimeout(r, MIN_GAP_MS - gap));
    lastRequestAt = Date.now();
}

interface ReverseResult {
    city: string | null;
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
    const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
    if (!res.ok) {
        const empty: ReverseResult = { city: null, state: null, country: null };
        REVERSE_CACHE.set(key, empty);
        return empty;
    }
    const data = await res.json();
    const addr = data.address || {};
    const result: ReverseResult = {
        city: addr.city || addr.town || addr.village || addr.hamlet || addr.municipality || null,
        state: addr.state || addr.region || null,
        country: addr.country || null
    };
    REVERSE_CACHE.set(key, result);
    return result;
}

export async function searchCityPolygon(name: string, state: string | null, country: string | null): Promise<CityPolygon | null> {
    const qParts = [name, state, country].filter(Boolean) as string[];
    const cacheKey = qParts.join('|').toLowerCase();
    if (POLYGON_CACHE.has(cacheKey)) return POLYGON_CACHE.get(cacheKey) ?? null;

    await rateLimit();
    const q = encodeURIComponent(qParts.join(', '));
    const url = `${NOMINATIM_BASE}/search?q=${q}&format=json&polygon_geojson=1&limit=1&featuretype=city`;
    const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
    if (!res.ok) { POLYGON_CACHE.set(cacheKey, null); return null; }
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
