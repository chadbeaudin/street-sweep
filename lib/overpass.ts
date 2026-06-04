import { BoundingBox, OverpassResponse, OSMElement } from './types';
import { prisma } from './prisma';

const OVERPASS_ENDPOINTS = [
  'https://lz4.overpass-api.de/api/interpreter',
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.osm.ch/api/interpreter'
];

async function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

const ts = () => `[${new Date().toTimeString().slice(0, 8)}]`;

const OSM_CACHE = new Map<string, { data: OverpassResponse; timestamp: number }>();
const CACHE_TTL = 1000 * 60 * 60 * 24; // 24 hours
const IN_FLIGHT_REQUESTS = new Map<string, Promise<OverpassResponse>>();

// Circuit breaker: skip mirrors that failed recently
const MIRROR_FAILURES = new Map<string, number>();
const CIRCUIT_OPEN_TTL = 5 * 60 * 1000; // 5 minutes

function isCircuitOpen(endpoint: string): boolean {
  const lastFail = MIRROR_FAILURES.get(endpoint);
  return !!lastFail && (Date.now() - lastFail < CIRCUIT_OPEN_TTL);
}

function recordFailure(endpoint: string) {
  MIRROR_FAILURES.set(endpoint, Date.now());
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

  // Parse ways
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

    if (!tags['highway']) continue;
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
  // OSM API rejects requests where area > 0.25 sq degrees
  const latSpan = bbox.north - bbox.south;
  const lonSpan = bbox.east - bbox.west;
  if (latSpan * lonSpan > 0.25) {
    console.warn(`${ts()} OSM API fallback skipped — bbox too large (${(latSpan * lonSpan).toFixed(3)} sq deg)`);
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
    console.error(`${ts()} OSM API fallback failed:`, err.message);
    return null;
  }
}

const DB_CACHE_TTL = 1000 * 60 * 60 * 24 * 30; // 30 days

async function getDbCached(key: string): Promise<OverpassResponse | null> {
  try {
    const row = await prisma.osmCache.findUnique({ where: { key } });
    if (!row) return null;
    if (Date.now() - row.fetchedAt.getTime() > DB_CACHE_TTL) {
      await prisma.osmCache.delete({ where: { key } }).catch(() => {});
      return null;
    }
    return row.data as unknown as OverpassResponse;
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

export async function fetchOSMData(bbox: BoundingBox): Promise<OverpassResponse> {
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

  // Round to 3 decimal places (~110m) for much better cache hit rate
  const round = (n: number) => Math.round(n * 1000) / 1000;
  // v2: removed footway and path to avoid parallel sidewalk inflation
  const cacheKey = `v2_${round(bbox.south)},${round(bbox.west)},${round(bbox.north)},${round(bbox.east)}`;
  const now = Date.now();

  // 1. Check in-memory cache
  const cached = OSM_CACHE.get(cacheKey);
  if (cached && (now - cached.timestamp < CACHE_TTL)) {
    if (cached.data.elements.length > 0) {
      console.log(`${ts()} Returning cached OSM data (${cached.data.elements.length} elems) for ${cacheKey}`);
      return cached.data;
    }
    console.log(`${ts()} Cached data for ${cacheKey} is empty. Retrying network...`);
  }

  // 2. Check persistent DB cache (survives server restarts)
  const dbCached = await getDbCached(cacheKey);
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
            const timeoutId = setTimeout(() => controller.abort(), 25000); // 25s timeout

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

              // HEURISTIC: If we get 0 elements from a major mirror for a road query,
              // it's VERY likely the mirror is returning incomplete data.
              if (data.elements.length === 0) {
                console.warn(`${ts()} Mirror ${endpoint} returned 0 elements. Trying next mirror...`);
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
              recordFailure(endpoint);
              continue;
            }

            const errorText = await response.text();
            recordFailure(endpoint);
            throw new Error(`Overpass API error: ${response.status}. ${errorText.substring(0, 100)}`);
          } catch (error: any) {
            console.error(`${ts()} Request to ${endpoint} failed:`, error.message);
            recordFailure(endpoint);
            lastError = error;
          }
        }
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
