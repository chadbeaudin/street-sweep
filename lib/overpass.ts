import { BoundingBox, OverpassResponse, OSMElement } from './types';
import { isRoutableHighway } from './highwayFilter';
import { prisma } from './prisma';
import { readDiskCache, writeDiskCache } from './osmDiskCache';

// Self-hosted Overpass first (no rate limits), public mirrors as fallback for
// areas outside the local extract. Set OVERPASS_URL to the /api/interpreter
// endpoint of a self-hosted instance (e.g. via Cloudflare Tunnel).
const OVERPASS_ENDPOINTS = [
  ...(process.env.OVERPASS_URL ? [process.env.OVERPASS_URL] : []),
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
const CACHE_TTL = 1000 * 60 * 60 * 24 * 30; // 30 days — OSM streets are effectively static at this timescale
const IN_FLIGHT_REQUESTS = new Map<string, Promise<OverpassResponse>>();

// Overpass mirrors allow only ~2 query slots per IP; firing more concurrent
// requests queues them server-side until our client timeout aborts them.
const MAX_CONCURRENT_FETCHES = 2;
let activeFetches = 0;
const fetchWaiters: (() => void)[] = [];
async function acquireFetchSlot(): Promise<void> {
    if (activeFetches < MAX_CONCURRENT_FETCHES) {
        activeFetches++;
        return;
    }
    await new Promise<void>(resolve => fetchWaiters.push(resolve));
    activeFetches++;
}
function releaseFetchSlot(): void {
    activeFetches--;
    fetchWaiters.shift()?.();
}

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

  // Parse ways — must match the highway types allowed by the Overpass query
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

    if (!isRoutableHighway(tags['highway'], tags)) continue;
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

        // Check if actual data bounds cover the requested area
        // Use a generous margin to account for tile-snapping: requests rounded to 0.001 degree
        // tiles might have small overlaps that don't perfectly align. 0.01 degree (~1km) is safe.
        const margin = 0.01;
        const covers = minLat <= requestedBbox.south + margin &&
                       maxLat >= requestedBbox.north - margin &&
                       minLon <= requestedBbox.west + margin &&
                       maxLon >= requestedBbox.east - margin;

        if (!covers) {
          console.warn(`${ts()} DB cache for ${key} doesn't cover requested bbox — invalidating`);
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

// Cap on cached OSM tiles. Each tile is large JSON (~0.5-1MB), so an unbounded
// cache filled the 512MB Neon project. Keep the most-recently-fetched tiles and
// evict the oldest beyond the cap.
const OSM_CACHE_MAX_ROWS = 300;

async function setDbCached(key: string, data: OverpassResponse): Promise<void> {
  // With a self-hosted Overpass (OVERPASS_URL), re-querying is fast and unlimited,
  // so there's no reason to persist tiles in Neon — skip the write entirely and
  // let the in-memory cache handle hot repeats. Keeps the DB tiny.
  if (process.env.OVERPASS_URL) return;
  try {
    await prisma.osmCache.upsert({
      where: { key },
      update: { data: data as any, fetchedAt: new Date() },
      create: { key, data: data as any }
    });
    await evictOsmCache();
  } catch (e: any) {
    console.error(`${ts()} DB cache write failed:`, e.message);
  }
}

async function evictOsmCache(): Promise<void> {
  try {
    const count = await prisma.osmCache.count();
    if (count <= OSM_CACHE_MAX_ROWS) return;
    const stale = await prisma.osmCache.findMany({
      orderBy: { fetchedAt: 'asc' },
      take: count - OSM_CACHE_MAX_ROWS,
      select: { key: true }
    });
    await prisma.osmCache.deleteMany({ where: { key: { in: stale.map(s => s.key) } } });
  } catch (e: any) {
    console.warn(`${ts()} OSM cache eviction failed:`, e.message);
  }
}

export function clearOSMCache() {
  OSM_CACHE.clear();
}

export function resetCircuitBreakers() {
  MIRROR_FAILURES.clear();
}

// Tile size in degrees. ~550m at the equator, ~370m at latitude 47.
// Any requested bbox is snapped UP to align with this grid, so near-identical
// requests share the same cache entry while still keeping the fetched area
// close to what was actually requested (avoids dragging in roads from far away).
const TILE_DEG = 0.005;

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
  // Snap to a fine grid (~500m) so panning/redrawing similar areas hits cache
  // without fetching tiles much larger than the request.
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
      elements: [],
      skippedTooLarge: true
    };
  }

  // Tile coords are already multiples of TILE_DEG; format to fixed precision for a stable key.
  const k = (n: number) => n.toFixed(4);
  // v4: fine-grained tile-aligned cache keys (0.005° tiles, ~500m). Old v3 entries ignored.
  const cacheKey = `v6_${k(bbox.south)},${k(bbox.west)},${k(bbox.north)},${k(bbox.east)}`;
  const now = Date.now();

  // For medium/large areas, reject cached responses that are clearly incomplete.
  const bboxArea = latSpan * lonSpan;
  // Density floor calibrated to the ways-only Overpass query (`out geom`), which
  // returns ~500k ways/sq deg in urban grids — NOT the node-heavy OSM API fallback
  // format (~40M elems/sq deg). 100k/sq deg catches truncated/corrupt fetches with
  // ~5x margin. Small selections (< 0.003 sq deg) are trusted entirely.
  const minElements = bboxArea > 0.003 ? Math.min(500, Math.round(bboxArea * 100_000)) : 0;

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

  // 2. Check on-disk cache (survives process restart, no Neon egress).
  // OSM data is effectively static at 30-day timescales, so the disk layer is
  // the workhorse: after first read, Neon never sees this tile again.
  const diskCached = await readDiskCache(cacheKey);
  if (diskCached && diskCached.elements.length > 0) {
    console.log(`${ts()} Returning disk-cached OSM data (${diskCached.elements.length} elems) for ${cacheKey}`);
    OSM_CACHE.set(cacheKey, { data: diskCached, timestamp: now });
    return diskCached;
  }

  // 3. Check persistent DB cache (Neon — shared across instances).
  // With a self-hosted Overpass, re-querying it is as fast as a Neon round-trip
  // and doesn't cost egress, so skip Neon reads entirely and fall through to it.
  const dbCached = process.env.OVERPASS_URL ? null : await getDbCached(cacheKey, minElements, bbox);
  if (dbCached && dbCached.elements.length > 0) {
    console.log(`${ts()} Returning DB-cached OSM data (${dbCached.elements.length} elems) for ${cacheKey}`);
    OSM_CACHE.set(cacheKey, { data: dbCached, timestamp: now });
    // Seed the local disk so subsequent reads skip Neon entirely.
    // writeDiskCache catches internally, so a fire-and-forget call is safe.
    void writeDiskCache(cacheKey, dbCached);
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
      (
        way["highway"~"motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|motorway_link|trunk_link|primary_link|secondary_link|tertiary_link|track|cycleway|path|bridleway"]
           ["access"!~"private|no"]
           (${bbox.south},${bbox.west},${bbox.north},${bbox.east});
        way["highway"="footway"]["footway"!~"sidewalk|crossing"]["bicycle"!~"no|private"]
           ["access"!~"private|no"]
           (${bbox.south},${bbox.west},${bbox.north},${bbox.east});
        way["highway"="service"]["service"!~"alley|driveway|parking_aisle|emergency_access"]
           ["access"!~"private|no"]
           (${bbox.south},${bbox.west},${bbox.north},${bbox.east});
      );
      out geom;
    `;

    let lastError: Error | null = null;
    const maxRetries = 1; // One pass through all mirrors

    await acquireFetchSlot();
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
            // 25s: large-area queries legitimately take >10s; aborting too early
            // cascades through every mirror and lands on the slow OSM API fallback.
            const timeoutId = setTimeout(() => controller.abort(), 25000);

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
              // Calibrated to the ways-only query above (~500k ways/sq deg urban);
              // see minElements above. Rejecting valid responses here cascades into
              // circuit-breaker failures on healthy mirrors and slow API fallbacks.
              // The density floor assumes urban road grids — it's wrong for legitimately
              // sparse/rural terrain (e.g. high desert), so only apply it to public
              // mirrors; our self-hosted instance (OVERPASS_URL) is full-coverage and
              // authoritative, so a low count there means the area really is sparse.
              const isSelfHosted = endpoint === process.env.OVERPASS_URL;
              const sparseFloor = Math.min(500, Math.round(bboxArea * 100_000));
              if (data.elements.length === 0 || (!isSelfHosted && bboxArea > 0.003 && data.elements.length < sparseFloor)) {
                console.warn(`${ts()} Mirror ${endpoint} returned ${data.elements.length} elements (floor ${sparseFloor}). Trying next mirror...`);
                recordFailure(endpoint);
                continue;
              }

              recordSuccess(endpoint);
              OSM_CACHE.set(cacheKey, { data, timestamp: Date.now() });
              setDbCached(cacheKey, data); // fire-and-forget
              void writeDiskCache(cacheKey, data);
              return data;
            }

            if (response.status === 504 || response.status === 429 || response.status === 509) {
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
        void writeDiskCache(cacheKey, osmFallback);
        return osmFallback;
      }

      return {
        version: 0.6,
        generator: 'StreetSweep fallback',
        osm3s: { timestamp_osm_base: new Date().toISOString(), copyright: '' },
        elements: []
      };
    } finally {
      releaseFetchSlot();
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
