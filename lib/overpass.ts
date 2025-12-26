import { BoundingBox, OverpassResponse } from './types';

const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://lz4.overpass-api.de/api/interpreter',
  'https://overpass.osm.ch/api/interpreter'
];

async function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

const ts = () => `[${new Date().toTimeString().slice(0, 8)}]`;

const OSM_CACHE = new Map<string, { data: OverpassResponse; timestamp: number }>();
const CACHE_TTL = 1000 * 60 * 60; // 1 hour
const IN_FLIGHT_REQUESTS = new Map<string, Promise<OverpassResponse>>();

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
    console.log(`${ts()} Returning cached OSM data for ${cacheKey}`);
    return cached.data;
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
      way["highway"]
         ["highway"!~"motorway|trunk|motorway_link|trunk_link"]
         ["access"!~"private|no"]
         (${bbox.south},${bbox.west},${bbox.north},${bbox.east});
      out geom;
    `;

    let lastError: Error | null = null;
    const maxRetries = 2; // Reduced retries per mirror set

    // Shuffle mirrors to distribute load and avoid sticky 504s on the primary
    const shuffledEndpoints = [...OVERPASS_ENDPOINTS].sort(() => Math.random() - 0.5);

    try {
      for (let attempt = 0; attempt < maxRetries; attempt++) {
        for (const endpoint of shuffledEndpoints) {
          try {
            console.log(`${ts()} Fetching OSM data from ${endpoint} (Attempt ${attempt + 1})...`);
            const response = await fetch(endpoint, {
              method: 'POST',
              body: bikeQuery,
              headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
            });

            if (response.ok) {
              const data = (await response.json()) as OverpassResponse;
              OSM_CACHE.set(cacheKey, { data, timestamp: Date.now() });
              return data;
            }

            if (response.status === 504 || response.status === 429) {
              console.warn(`${ts()} Endpoint ${endpoint} failed with ${response.status}. Trying next mirror...`);
              continue;
            }

            const errorText = await response.text();
            throw new Error(`Overpass API error: ${response.status} ${response.statusText}. ${errorText}`);
          } catch (error: any) {
            console.error(`${ts()} Attempt ${attempt + 1} at ${endpoint} failed:`, error.message);
            lastError = error;
          }
        }

        if (attempt < maxRetries - 1) {
          const backoff = Math.pow(2, attempt) * 1000;
          console.log(`${ts()} All mirrors failed. Retrying in ${backoff}ms...`);
          await delay(backoff);
        }
      }
      throw lastError || new Error("Failed to fetch OSM data after multiple attempts.");
    } finally {
      // Always remove from in-flight map when finished (success or failure)
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
