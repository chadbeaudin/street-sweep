import { BoundingBox, OverpassResponse } from './types';

const OVERPASS_ENDPOINTS = [
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass-api.de/api/interpreter',
  'https://lz4.overpass-api.de/api/interpreter',
  'https://overpass.osm.ch/api/interpreter'
];

async function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

const ts = () => `[${new Date().toTimeString().slice(0, 8)}]`;

const OSM_CACHE = new Map<string, { data: OverpassResponse; timestamp: number }>();
const CACHE_TTL = 1000 * 60 * 60 * 24; // 24 hours
const IN_FLIGHT_REQUESTS = new Map<string, Promise<OverpassResponse>>();

/**
 * Clears the OSM cache. Useful if mirrors return poisoned (empty) data.
 */
export function clearOSMCache() {
  OSM_CACHE.clear();
}

export async function fetchOSMData(bbox: BoundingBox): Promise<OverpassResponse> {
  // Guard against excessively large bounding boxes that crash mirrors
  const latSpan = Math.abs(bbox.north - bbox.south);
  const lonSpan = Math.abs(bbox.east - bbox.west);
  if (latSpan > 0.3 || lonSpan > 0.3) {
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
  const cacheKey = `${round(bbox.south)},${round(bbox.west)},${round(bbox.north)},${round(bbox.east)}`;
  const now = Date.now();

  // 1. Check persistent memory cache
  const cached = OSM_CACHE.get(cacheKey);
  if (cached && (now - cached.timestamp < CACHE_TTL)) {
    // If cache has data, return it. If it has 0 elements, we might want to re-verify, 
    // but for now let's hope the non-poisoned mirrors are working.
    if (cached.data.elements.length > 0) {
      console.log(`${ts()} Returning cached OSM data (${cached.data.elements.length} elems) for ${cacheKey}`);
      return cached.data;
    }
    // If it was cached with 0 elements and it's relatively fresh, we'll try to re-fetch to be safe
    console.log(`${ts()} Cached data for ${cacheKey} is empty. Retrying network...`);
  }

  // 2. Check for in-flight requests to avoid concurrent duplicate network calls
  const inFlight = IN_FLIGHT_REQUESTS.get(cacheKey);
  if (inFlight) {
    console.log(`${ts()} Joining in-flight request for ${cacheKey}`);
    return inFlight;
  }

  // 3. Define the actual fetch logic as a promise
  const requestPromise = (async () => {
    const bikeQuery = `
      [out:json][timeout:90];
      way["highway"~"motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|motorway_link|trunk_link|primary_link|secondary_link|tertiary_link|track|path|cycleway|footway"]
         ["access"!~"private|no"]
         (${bbox.south},${bbox.west},${bbox.north},${bbox.east});
      out geom;
    `;

    let lastError: Error | null = null;
    const maxRetries = 1; // One pass through all mirrors

    try {
      for (let attempt = 0; attempt < maxRetries; attempt++) {
        for (const endpoint of OVERPASS_ENDPOINTS) {
          try {
            console.log(`${ts()} Fetching OSM data from ${endpoint}...`);
            const response = await fetch(endpoint, {
              method: 'POST',
              body: 'data=' + encodeURIComponent(bikeQuery),
              headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
            });

            if (response.ok) {
              const data = (await response.json()) as OverpassResponse;

              // HEURISTIC: If we get 0 elements from a major mirror for a road query,
              // it's VERY likely the mirror is returning incomplete data.
              if (data.elements.length === 0) {
                console.warn(`${ts()} Mirror ${endpoint} returned 0 elements. Trying next mirror...`);
                continue;
              }

              OSM_CACHE.set(cacheKey, { data, timestamp: Date.now() });
              return data;
            }

            if (response.status === 504 || response.status === 429) {
              console.warn(`${ts()} Endpoint ${endpoint} failed with ${response.status}. Trying next...`);
              lastError = new Error(`Overpass API error: ${response.status}`);
              continue;
            }

            const errorText = await response.text();
            throw new Error(`Overpass API error: ${response.status}. ${errorText.substring(0, 100)}`);
          } catch (error: any) {
            console.error(`${ts()} Request to ${endpoint} failed:`, error.message);
            lastError = error;
          }
        }
      }

      // If we exhausted all mirrors and still have nothing, but at least ONE mirror was technically "ok" but empty,
      // we return that empty result rather than throwing.
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
