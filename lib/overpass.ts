import { BoundingBox, OverpassResponse } from './types';

const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://lz4.overpass-api.de/api/interpreter'
];

async function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

const ts = () => `[${new Date().toTimeString().slice(0, 8)}]`;

export async function fetchOSMData(bbox: BoundingBox): Promise<OverpassResponse> {
  const bikeQuery = `
    [out:json][timeout:30];
    (
      way["highway"]
         ["highway"!~"motorway|trunk|motorway_link|trunk_link"]
         ["access"!~"private|no"]
         (${bbox.south},${bbox.west},${bbox.north},${bbox.east});
    );
    (._;>;);
    out body;
  `;

  let lastError: Error | null = null;
  const maxRetries = 3;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    // Try each endpoint in order
    for (const endpoint of OVERPASS_ENDPOINTS) {
      try {
        console.log(`${ts()} Fetching OSM data from ${endpoint} (Attempt ${attempt + 1})...`);
        const response = await fetch(endpoint, {
          method: 'POST',
          body: bikeQuery,
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        });

        if (response.ok) {
          return (await response.json()) as OverpassResponse;
        }

        // If 504 or 429, we should definitely retry another mirror
        if (response.status === 504 || response.status === 429) {
          console.warn(`${ts()} Endpoint ${endpoint} failed with ${response.status}. Trying next mirror...`);
          lastError = new Error(`Overpass API error: ${response.status} ${response.statusText}`);
          continue;
        }

        const errorText = await response.text();
        throw new Error(`Overpass API error: ${response.status} ${response.statusText}. ${errorText}`);
      } catch (error: any) {
        console.error(`${ts()} Attempt ${attempt + 1} at ${endpoint} failed:`, error.message);
        lastError = error;
      }
    }

    // Wait before next round of retries
    if (attempt < maxRetries - 1) {
      const backoff = Math.pow(2, attempt) * 1000;
      console.log(`${ts()} All mirrors failed. Retrying in ${backoff}ms...`);
      await delay(backoff);
    }
  }

  throw lastError || new Error("Failed to fetch OSM data after multiple attempts.");
}

export async function fetchOSMDataByQuery(queryStr: string): Promise<OverpassResponse> {
  throw new Error("Not implemented");
}
