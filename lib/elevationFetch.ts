// Server-only: fetching elevations from the providers. The profile math is in
// lib/elevation.ts, which the browser also imports.
import distance from '@turf/distance';
import { point } from '@turf/helpers';
import { recordExternalBreaker, recordExternalCall } from './metrics';

const ts = () => `[${new Date().toTimeString().slice(0, 8)}]`;

interface ElevationProvider {
    name: string;
    metric: string;
    batchSize: number;
    selfHosted?: boolean; // skips the inter-batch throttling delay meant for shared public APIs
    fetch(lats: string[], lons: string[]): Promise<number[]>;
}

// Self-hosted Open Topo Data instance (no rate limits) — see lib/overpass.ts
// for the same OVERPASS_URL pattern. Only serves copernicus90 (90m); falls
// through to Open-Meteo if the box is unreachable.
const OPEN_TOPO_URL = process.env.OPEN_TOPO_URL || 'https://opentopodata.bigtimber.cloud';

const OpenMeteoProvider: ElevationProvider = {
    name: 'Open-Meteo',
    metric: 'open_meteo',
    batchSize: 500, // Open-Meteo supports up to 5000 per request
    async fetch(lats, lons) {
        const url = `https://api.open-meteo.com/v1/elevation?latitude=${lats.join(',')}&longitude=${lons.join(',')}`;
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (!data.elevation) throw new Error('Malformed response');
        return data.elevation;
    }
};

const SelfHostedOpenTopoProvider: ElevationProvider = {
    name: 'Self-hosted Open Topo Data (Copernicus 90m)',
    metric: 'open_topo',
    // The server enforces its own max_locations regardless of who's asking
    // (confirmed: 261 locations → "Too many locations provided (261), the
    // limit is 100") — self-hosted only buys us no rate limiting, not a
    // bigger per-request cap.
    batchSize: 100,
    selfHosted: true,
    async fetch(lats, lons) {
        const locations = lats.map((lat, i) => `${lat},${lons[i]}`).join('|');
        const url = `${OPEN_TOPO_URL}/v1/copernicus90?locations=${locations}`;
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (!data.results) throw new Error('Malformed response');
        return data.results.map((r: any) => r.elevation);
    }
};

const PROVIDERS = [SelfHostedOpenTopoProvider, OpenMeteoProvider];

// Every added waypoint regenerates the whole route, so without this each click
// re-fetched elevation for every point already drawn. Keyed by provider so a
// fallback provider's values never mix into another's profile.
const ELEVATION_CACHE_MAX = 200_000;
const elevationCache = new Map<string, number>();
// Measured: the Nastromo Open Topo Data server takes ~5s per 100-location request
// but serves 8 at once in ~6s total, so batches are worth running side by side.
const SELF_HOSTED_CONCURRENCY = 8;

function cacheElevation(key: string, elevation: number) {
    elevationCache.delete(key);
    elevationCache.set(key, elevation);
    if (elevationCache.size > ELEVATION_CACHE_MAX) {
        elevationCache.delete(elevationCache.keys().next().value!);
    }
}

export function clearElevationCache() {
    elevationCache.clear();
}

const delay = (ms: number) => new Promise(res => setTimeout(res, ms));

async function fetchBatchWithRetry(provider: ElevationProvider, lats: string[], lons: string[]): Promise<number[]> {
    for (let retries = 0; retries < 3; retries++) {
        try {
            const elevations = await provider.fetch(lats, lons);
            recordExternalCall(provider.metric, 'ok');
            return elevations;
        } catch (err: any) {
            const rateLimited = err.message.includes('429');
            recordExternalCall(provider.metric, rateLimited ? 'rate_limited' : 'error');
            if (!rateLimited) throw err;
            const waitTime = Math.pow(2, retries) * 2000;
            console.warn(`${ts()} ${provider.name} rate limited (429). Retrying in ${waitTime}ms...`);
            await delay(waitTime);
        }
    }
    throw new Error(`Failed to fetch current batch from ${provider.name}`);
}

async function runWithConcurrency<T>(items: T[], limit: number, worker: (item: T, index: number) => Promise<void>) {
    let next = 0;
    const lanes = Array.from({ length: Math.min(limit, items.length) }, async () => {
        while (next < items.length) {
            const i = next++;
            await worker(items[i], i);
        }
    });
    await Promise.all(lanes);
}

/**
 * Fetches elevation data for a list of coordinates using multiple fallback providers.
 */
export async function fetchElevationData(coordinates: [number, number][]): Promise<{ elevations: number[], sampledCoords: [number, number][] }> {
    if (coordinates.length === 0) return { elevations: [], sampledCoords: [] };

    let totalMiles = 0;
    for (let i = 1; i < coordinates.length; i++) {
        totalMiles += distance(point(coordinates[i - 1]), point(coordinates[i]), { units: 'miles' });
    }

    const pointsPerMile = 200;
    // Cap doubled to 2000 — for routes long enough to hit it, this was the actual
    // limiter on hover granularity (not pointsPerMile), e.g. a 50mi route was
    // capped to ~20 pts/mile (~264ft between hover samples) regardless of this rate.
    let targetPoints = Math.max(50, Math.min(2000, Math.round(totalMiles * pointsPerMile)));
    targetPoints = Math.min(targetPoints, coordinates.length);

    const sampledCoords: [number, number][] = [];
    if (coordinates.length <= targetPoints) {
        sampledCoords.push(...coordinates);
    } else {
        const step = (coordinates.length - 1) / (targetPoints - 1);
        for (let i = 0; i < targetPoints; i++) {
            const index = Math.min(Math.round(i * step), coordinates.length - 1);
            sampledCoords.push(coordinates[index]);
        }
    }

    const lats = sampledCoords.map(c => c[1].toFixed(6));
    const lons = sampledCoords.map(c => c[0].toFixed(6));

    for (const provider of PROVIDERS) {
        try {
            console.log(`${ts()} Attempting elevation fetch with ${provider.name}...`);
            const keys = lats.map((lat, i) => `${provider.name}|${lat},${lons[i]}`);
            const missing = [...new Set(keys.filter(k => !elevationCache.has(k)))];
            const batches: string[][] = [];
            for (let i = 0; i < missing.length; i += provider.batchSize) batches.push(missing.slice(i, i + provider.batchSize));

            await runWithConcurrency(batches, provider.selfHosted ? SELF_HOSTED_CONCURRENCY : 1, async (batch, i) => {
                const coords = batch.map(k => k.slice(k.indexOf('|') + 1).split(','));
                const elevations = await fetchBatchWithRetry(provider, coords.map(c => c[0]), coords.map(c => c[1]));
                batch.forEach((k, j) => cacheElevation(k, elevations[j]));
                if (!provider.selfHosted && i < batches.length - 1) await delay(500);
            });

            console.log(`${ts()} Successfully fetched elevation from ${provider.name} (${missing.length}/${keys.length} looked up, rest cached)`);
            return { elevations: keys.map(k => elevationCache.get(k)!), sampledCoords };
        } catch (err: any) {
            console.warn(`${ts()} ${provider.name} failed: ${err.message}. Trying fallback...`);
            recordExternalBreaker(provider.metric);
        }
    }

    throw new Error('All elevation providers failed');
}
