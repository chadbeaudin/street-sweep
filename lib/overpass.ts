import { BoundingBox, OverpassResponse, OSMElement } from './types';
import { prisma } from './prisma';

const OVERPASS_ENDPOINTS = [
  'https://lz4.overpass-api.de/api/interpreter',
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.osm.ch/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass.openstreetmap.ru/api/interpreter',
];

async function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

const ts = () => `[${new Date().toTimeString().slice(0, 8)}]`;

const OSM_CACHE = new Map<string, { data: OverpassResponse; timestamp: number }>();
const CACHE_TTL = 1000 * 60 * 60 * 24; // 24 hours
const IN_FLIGHT_REQUESTS = new Map<string, Promise<OverpassResponse>>();

// Circuit breaker: skip mirrors that failed recently
const MIRROR_FAILURES = new Map<string, { time: number; transient: boolean }>();
const CIRCUIT_OPEN_TTL = 5 * 60 * 1000;         // 5 min for hard errors
const CIRCUIT_OPEN_TTL_TRANSIENT = 60 * 1000;    // 1 min for 429/504 (clears fast)

function isCircuitOpen(endpoint: string): boolean {
  const rec = MIRROR_FAILURES.get(endpoint);
  if (!rec) return false;
  const ttl = rec.transient ? CIRCUIT_OPEN_TTL_TRANSIENT : CIRCUIT_OPEN_TTL;
  return Date.now() - rec.time < ttl;
}

function recordFailure(endpoint: string, transient = false) {
  MIRROR_FAILURES.set(endpoint, { time: Date.now(), transient });
}

function recordSuccess(endpoint: string) {
  MIRROR_FAILURES.delete(endpoint);
}

const OSM_API_ENDPOINT = 'https://api.openstreetmap.org/api/0.6/map';

function parseOSMXML(xml: string): OverpassResponse {
  const elements: OSMElement[] = [];

  // Parse standalone nodes (needed as geometry lookup for ways)
  const nodeRe = /<node\b([^>]*?)(?:\/>|>[\s\S]*?<\/node>)/g;
  let m: RegExpExecArray | null;
  while ((m = nodeRe.exec(xml)) !== null) {
    const attrs = m[1];
    const id = /\bid="(\d+)"/.exec(attrs);
    const lat = /\blat="([^"]+)"/.exec(attrs);
    const lon = /\blon="([^"]+)"/.exec(attrs);
    if (id && lat && lon) {
      elements.push({ type: 'node', id: +id[1], lat: +lat[1], lon: +lon[1] });
    }
  }

  // Parse ways — must match the highway types in the Overpass query
  const ALLOWED_HIGHWAYS = new Set(['motorway','trunk','primary','secondary','tertiary',
    'unclassified','residential','living_street','motorway_link','trunk_link',
    'primary_link','secondary_link','tertiary_link','track','cycleway']);

  const wayRe = /<way\b([^>]*)>([\s\S]*?)<\/way>/g;
  while ((m = wayRe.exec(xml)) !== null) {
    const attrs = m[1];
    const body = m[2];
    const id = /\bid="(\d+)"/.exec(attrs);
    if (!id) continue;

    const tags: Record<string, string> = {};
    const tagRe = /<tag\b[^>]*\bk="([^"]+)"[^>]*\bv="([^"]*)"[^>]*>/g;
    let t: RegExpExecArray | null;
    while ((t = tagRe.exec(body)) !== null) tags[t[1]] = t[2];

    if (!tags['highway'] || !ALLOWED_HIGHWAYS.has(tags['highway'])) continue;
    if (tags['access'] === 'private' || tags['access'] === 'no') continue;

    const nodes: number[] = [];
    const ndRe = /<nd\b[^>]*\bref="(\d+)"/g;
    let nd: RegExpExecArray | null;
    while ((nd = ndRe.exec(body)) !== null) nodes.push(+nd[1]);
    if (nodes.length < 2) continue;

    elements.push({ type: 'way', id: +id[1], nodes, tags });
  }

  return {
    version: 0.6,
    generator: 'OpenStreetMap API',
    osm3s: { timestamp_osm_base: new Date().toISOString(), copyright: 'OpenStreetMap contributors' },
    elements
  };
}

async function fetchFromOSMAPI(bbox: BoundingBox): Promise<OverpassResponse | null> {
  // OSM API has a 50k-node limit that trips even in small cities at ~0.003 sq deg.
  // Only attempt it for very small bboxes where it's likely to succeed.
  const latSpan = bbox.north - bbox.south;
  const lonSpan = bbox.east - bbox.west;
  if (latSpan * lonSpan > 0.004) {
    console.warn(`${ts()} OSM API fallback skipped — bbox too large (${(latSpan * lonSpan).toFixed(4)} sq deg)`);
    return null;
  }

  const url = `${OSM_API_ENDPOINT}?bbox=${bbox.west},${bbox.south},${bbox.east},${bbox.north}`;
  console.log(`${ts()} Trying OSM API fallback (${latSpan.toFixed(3)}x${lonSpan.toFixed(3)})...`);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30000);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'StreetSweep/1.0 (Local Development)' }
    });
    clearTimeout(timeoutId);
    if (!response.ok) {
      const body = await response.text();
      console.warn(`${ts()} OSM API returned ${response.status}: ${body.substring(0, 200)}`);
      // 509 = rate limited — signal the split not to retry
      if (response.status === 509 || response.status === 429) throw Object.assign(new Error('rate-limited'), { rateLimit: true });
      return null;
    }
    const xml = await response.text();
    const data = parseOSMXML(xml);
    if (data.elements.length === 0) {
      console.warn(`${ts()} OSM API returned 0 elements`);
      return null;
    }
    console.log(`${ts()} OSM API fallback succeeded (${data.elements.length} elements)`);
    return data;
  } catch (err: any) {
    clearTimeout(timeoutId);
    if (err.rateLimit) throw err; // propagate so quadrant split can bail early
    console.error(`${ts()} OSM API fallback failed:`, err.message);
    return null;
  }
}

async function fetchFromOSMAPIWithSplit(bbox: BoundingBox): Promise<OverpassResponse | null> {
  try {
    const result = await fetchFromOSMAPI(bbox);
    if (result) return result;
  } catch (e: any) {
    if (e.rateLimit) { console.warn(`${ts()} OSM API rate-limited — skipping quadrant split`); return null; }
    throw e;
  }

  // Single call failed (likely node limit) — split into 2×2 quadrants sequentially to avoid
  // hammering the API with parallel requests and triggering a 509 rate limit.
  const midLat = (bbox.north + bbox.south) / 2;
  const midLon = (bbox.east + bbox.west) / 2;
  const quadrants: BoundingBox[] = [
    { south: bbox.south, west: bbox.west, north: midLat,      east: midLon      },
    { south: bbox.south, west: midLon,    north: midLat,      east: bbox.east   },
    { south: midLat,     west: bbox.west, north: bbox.north,  east: midLon      },
    { south: midLat,     west: midLon,    north: bbox.north,  east: bbox.east   },
  ];

  console.log(`${ts()} OSM API single call failed — trying 2×2 quadrant split...`);
  const merged: OSMElement[] = [];
  const seenIds = new Set<string>();

  for (const q of quadrants) {
    try {
      const r = await fetchFromOSMAPI(q);
      if (!r) continue;
      for (const el of r.elements) {
        const key = `${el.type}:${el.id}`;
        if (!seenIds.has(key)) { seenIds.add(key); merged.push(el); }
      }
    } catch (e: any) {
      if (e.rateLimit) { console.warn(`${ts()} OSM API rate-limited mid-split — using partial results`); break; }
    }
  }

  if (merged.length === 0) return null;
  console.log(`${ts()} OSM API quadrant split succeeded (${merged.length} elements)`);
  return {
    version: 0.6,
    generator: 'OpenStreetMap API (split)',
    osm3s: { timestamp_osm_base: new Date().toISOString(), copyright: 'OpenStreetMap contributors' },
    elements: merged,
  };
}

const DB_CACHE_TTL = 1000 * 60 * 60 * 24 * 30; // 30 days

async function getDbCached(key: string, minElements = 0, requestedBbox?: BoundingBox): Promise<OverpassResponse | null> {
  try {
    const row = await prisma.osmCache.findUnique({ where: { key } });
    if (!row) return null;
    if (Date.now() - row.fetchedAt.getTime() > DB_CACHE_TTL) {
      await prisma.osmCache.delete({ where: { key } }).catch(() => {});
      return null;
    }
    const data = row.data as unknown as OverpassResponse;

    // Validate that cached data actually covers the requested area
    if (requestedBbox && data.elements.length > 0) {
      const nodeElements = data.elements.filter(e => e.type === 'node');
      if (nodeElements.length > 0) {
        const lats = nodeElements.map((n: any) => n.lat);
        const lons = nodeElements.map((n: any) => n.lon);
        const minLat = Math.min(...lats);
        const maxLat = Math.max(...lats);
        const minLon = Math.min(...lons);
        const maxLon = Math.max(...lons);

        // Check if actual data bounds cover the requested area (with 1% margin)
        const margin = 0.001;
        const covers = minLat <= requestedBbox.south + margin &&
                       maxLat >= requestedBbox.north - margin &&
                       minLon <= requestedBbox.west + margin &&
                       maxLon >= requestedBbox.east - margin;

        if (!covers) {
          console.warn(`${ts()} DB cache for ${key} doesn't cover requested bbox (data: [${minLat.toFixed(4)},${minLon.toFixed(4)} to ${maxLat.toFixed(4)},${maxLon.toFixed(4)}], requested: [${requestedBbox.south.toFixed(4)},${requestedBbox.west.toFixed(4)} to ${requestedBbox.north.toFixed(4)},${requestedBbox.east.toFixed(4)}]) — invalidating`);
          await prisma.osmCache.delete({ where: { key } }).catch(() => {});
          return null;
        }
      }
    }
    // If the response is suspiciously sparse for the requested area and was not
    // fetched recently (i.e. it's not a legitimately sparse area we just confirmed),
    // invalidate so the next request re-fetches fresh data.
    if (minElements > 0 && data.elements.length < minElements) {
      const ageMs = Date.now() - row.fetchedAt.getTime();
      if (ageMs > 300000) { // older than 5 min → not a "just confirmed sparse" entry
        console.warn(`${ts()} DB cache for ${key} is stale+sparse (${data.elements.length} < ${minElements} elems) — invalidating`);
        await prisma.osmCache.delete({ where: { key } }).catch(() => {});
        return null;
      }
    }
    return data;
  } catch {
    return null;
  }
}

async function setDbCached(key: string, data: OverpassResponse): Promise<void> {
  try {
    await prisma.osmCache.upsert({
      where: { key },
      update: { data: data as any, fetchedAt: new Date() },
      create: { key, data: data as any }
    });
  } catch (e: any) {
    console.error(`${ts()} DB cache write failed:`, e.message);
  }
}

export function clearOSMCache() {
  OSM_CACHE.clear();
}

export function resetCircuitBreakers() {
  MIRROR_FAILURES.clear();
}

// Tile size in degrees. ~5.5km at the equator, ~3.7km at latitude 47.
// Any requested bbox is snapped UP to align with this grid, so panning within
// the same tile-set always hits the cache.
const TILE_DEG = 0.05;

export function snapBboxToTileGrid(bbox: BoundingBox): BoundingBox {
  const snap = (n: number, dir: 'floor' | 'ceil') => Math[dir](n / TILE_DEG) * TILE_DEG;
  return {
    south: snap(bbox.south, 'floor'),
    west:  snap(bbox.west,  'floor'),
    north: snap(bbox.north, 'ceil'),
    east:  snap(bbox.east,  'ceil'),
  };
}

export async function fetchOSMData(requestedBbox: BoundingBox): Promise<OverpassResponse> {
  // Snap request up to the tile grid so adjacent/overlapping requests share cache entries.
  const bbox = snapBboxToTileGrid(requestedBbox);

  // Guard against excessively large bounding boxes that crash mirrors
  const latSpan = Math.abs(bbox.north - bbox.south);
  const lonSpan = Math.abs(bbox.east - bbox.west);
  if (latSpan > 0.5 || lonSpan > 0.5) {
    console.warn(`${ts()} Bounding box too large (${latSpan.toFixed(3)}x${lonSpan.toFixed(3)}), skipping request.`);
    return {
      version: 0.6,
      generator: 'StreetSweep Dummy',
      osm3s: { timestamp_osm_base: new Date().toISOString(), copyright: '' },
      elements: []
    };
  }

  // Tile coords are already multiples of TILE_DEG; format to fixed precision for a stable key.
  const k = (n: number) => n.toFixed(3);
  // v3: tile-aligned cache keys (was: 3-decimal rounded). Old v2 entries are now ignored.
  const cacheKey = `v3_${k(bbox.south)},${k(bbox.west)},${k(bbox.north)},${k(bbox.east)}`;
  const now = Date.now();

  // For medium/large areas, reject cached responses that are clearly incomplete.
  // 500 is conservative: even sparse residential grids return thousands of elements.
  // Entries fetched within the last hour are trusted (they may be legitimately sparse).
  const bboxArea = latSpan * lonSpan;
  // Density-based floor: ~1M elements per sq deg catches severely sparse/corrupt fetches
  // while allowing legitimate small-area caches. Small selections (< 0.003 sq deg) are
  // trusted entirely; larger areas need at least 2000 elements to be considered complete.
  const minElements = bboxArea > 0.003 ? Math.min(2000, Math.round(bboxArea * 1_000_000)) : 0;

  // 1. Check in-memory cache
  const cached = OSM_CACHE.get(cacheKey);
  if (cached && (now - cached.timestamp < CACHE_TTL)) {
    if (cached.data.elements.length > 0) {
      const isSparse = minElements > 0 && cached.data.elements.length < minElements;
      const isStale = now - cached.timestamp > 300000; // older than 5 min in memory
      if (isSparse && isStale) {
        console.warn(`${ts()} In-memory cache for ${cacheKey} is stale+sparse (${cached.data.elements.length} elems) — invalidating`);
        OSM_CACHE.delete(cacheKey);
      } else {
        console.log(`${ts()} Returning cached OSM data (${cached.data.elements.length} elems) for ${cacheKey}`);
        return cached.data;
      }
    } else {
      console.log(`${ts()} Cached data for ${cacheKey} is empty. Retrying network...`);
    }
  }

  // 2. Check persistent DB cache (survives server restarts)
  const dbCached = await getDbCached(cacheKey, minElements, bbox);
  if (dbCached && dbCached.elements.length > 0) {
    console.log(`${ts()} Returning DB-cached OSM data (${dbCached.elements.length} elems) for ${cacheKey}`);
    OSM_CACHE.set(cacheKey, { data: dbCached, timestamp: now }); // warm memory cache
    return dbCached;
  }

  // 3. Check for in-flight requests to avoid concurrent duplicate network calls
  const inFlight = IN_FLIGHT_REQUESTS.get(cacheKey);
  if (inFlight) {
    console.log(`${ts()} Joining in-flight request for ${cacheKey}`);
    return inFlight;
  }

  // 3. Define the actual fetch logic as a promise
  const requestPromise = (async () => {
    const bikeQuery = `
      [out:json][timeout:90];
      way["highway"~"motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|motorway_link|trunk_link|primary_link|secondary_link|tertiary_link|track|cycleway"]
         ["access"!~"private|no"]
         (${bbox.south},${bbox.west},${bbox.north},${bbox.east});
      out geom;
    `;

    let lastError: Error | null = null;
    const maxRetries = 1; // One pass through all mirrors

    try {
      for (let attempt = 0; attempt < maxRetries; attempt++) {
        for (const endpoint of OVERPASS_ENDPOINTS) {
          if (isCircuitOpen(endpoint)) {
            console.log(`${ts()} Skipping ${endpoint} (circuit open)`);
            continue;
          }
          try {
            console.log(`${ts()} Fetching OSM data from ${endpoint}...`);
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 10000); // 10s timeout

            const response = await fetch(endpoint, {
              method: 'POST',
              body: 'data=' + encodeURIComponent(bikeQuery),
              signal: controller.signal,
              headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Accept': 'application/json',
                'User-Agent': 'StreetSweep/1.0 (Local Development)'
              }
            });
            clearTimeout(timeoutId);

            if (response.ok) {
              const data = (await response.json()) as OverpassResponse;

              // Reject responses that are clearly incomplete for the requested area.
              // A healthy urban tile returns ~50M elements/sq deg; our floor is ~1M.
              const sparseFloor = Math.min(2000, Math.round(bboxArea * 1_000_000));
              if (data.elements.length === 0 || (bboxArea > 0.003 && data.elements.length < sparseFloor)) {
                console.warn(`${ts()} Mirror ${endpoint} returned ${data.elements.length} elements (floor ${sparseFloor}). Trying next mirror...`);
                recordFailure(endpoint);
                continue;
              }

              recordSuccess(endpoint);
              OSM_CACHE.set(cacheKey, { data, timestamp: Date.now() });
              setDbCached(cacheKey, data); // fire-and-forget
              return data;
            }

            if (response.status === 504 || response.status === 429) {
              console.warn(`${ts()} Endpoint ${endpoint} failed with ${response.status}. Trying next...`);
              lastError = new Error(`Overpass API error: ${response.status}`);
              recordFailure(endpoint, true); // transient — short circuit TTL
              continue;
            }

            const errorText = await response.text();
            recordFailure(endpoint, false);
            throw new Error(`Overpass API error: ${response.status}. ${errorText.substring(0, 100)}`);
          } catch (error: any) {
            console.error(`${ts()} Request to ${endpoint} failed:`, error.message);
            // Timeouts (AbortError) mean the endpoint is slow/overloaded — use full TTL
            recordFailure(endpoint, false);
            lastError = error;
          }
        }
      }

      // All Overpass endpoints failed — try the direct OSM API as a last resort.
      // If the bbox is too large for one call, split it into a 2×2 grid and merge.
      console.warn(`${ts()} All Overpass endpoints exhausted. Trying OSM API fallback...`);
      const osmFallback = await fetchFromOSMAPIWithSplit(bbox);
      if (osmFallback && osmFallback.elements.length > 0) {
        OSM_CACHE.set(cacheKey, { data: osmFallback, timestamp: Date.now() });
        setDbCached(cacheKey, osmFallback);
        return osmFallback;
      }

      return {
        version: 0.6,
        generator: 'StreetSweep fallback',
        osm3s: { timestamp_osm_base: new Date().toISOString(), copyright: '' },
        elements: []
      };
    } finally {
      IN_FLIGHT_REQUESTS.delete(cacheKey);
    }
  })();

  // 4. Register in-flight promise and return it
  IN_FLIGHT_REQUESTS.set(cacheKey, requestPromise);
  return requestPromise;
}

export async function fetchOSMDataByQuery(queryStr: string): Promise<OverpassResponse> {
  throw new Error("Not implemented");
}
