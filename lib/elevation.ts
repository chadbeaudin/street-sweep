import distance from '@turf/distance';
import { point } from '@turf/helpers';

export interface ElevationPoint {
    distance: number;
    elevation: number;
    lat: number;
    lon: number;
}

const ts = () => `[${new Date().toTimeString().slice(0, 8)}]`;

interface ElevationProvider {
    name: string;
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
            return await provider.fetch(lats, lons);
        } catch (err: any) {
            if (!err.message.includes('429')) throw err;
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
        }
    }

    throw new Error('All elevation providers failed');
}

/**
 * Sums elevation gain/loss with hysteresis: a climb/descent only "banks" once it
 * reverses by at least `threshold` (same unit as `elevations`). Naively summing
 * every consecutive uphill
 * delta wildly overstates gain on routes with many points (e.g. a dense CPP
 * street sweep) — each point is an independent DEM lookup, and SRTM's own
 * vertical noise (a few meters) gets counted as real elevation change hundreds
 * of times over. This matches how GPS devices/Strava report gain.
 */
export function calculateElevationGainLoss(elevations: number[], threshold: number): { gain: number; loss: number } {
    if (elevations.length < 2) return { gain: 0, loss: 0 };
    let gain = 0, loss = 0;
    let anchor = elevations[0];
    let runningMax = elevations[0];
    let runningMin = elevations[0];
    let direction: 'up' | 'down' | null = null;

    for (let i = 1; i < elevations.length; i++) {
        const e = elevations[i];
        if (direction !== 'down' && e >= runningMax) {
            runningMax = e;
            direction = 'up';
        } else if (direction !== 'up' && e <= runningMin) {
            runningMin = e;
            direction = 'down';
        } else if (direction === 'up' && runningMax - e >= threshold) {
            gain += runningMax - anchor;
            anchor = runningMax; // the confirmed peak, not the confirmation point
            runningMin = e;
            direction = 'down';
        } else if (direction === 'down' && e - runningMin >= threshold) {
            loss += anchor - runningMin;
            anchor = runningMin; // the confirmed trough, not the confirmation point
            runningMax = e;
            direction = 'up';
        }
    }
    if (direction === 'up') gain += runningMax - anchor;
    else if (direction === 'down') loss += anchor - runningMin;

    return { gain: Math.round(gain), loss: Math.round(loss) };
}

/**
 * Processes raw elevation data and coordinates into a distance-based profile.
 */
export function calculateElevationProfile(coords: [number, number][], elevations: number[]): ElevationPoint[] {
    let totalDistance = 0;
    return coords.map((c, i) => {
        if (i > 0) {
            const p1 = point(coords[i - 1]);
            const p2 = point(coords[i]);
            const dist = distance(p1, p2, { units: 'miles' });
            totalDistance += dist;
        }
        return {
            distance: parseFloat(totalDistance.toFixed(2)),
            elevation: Math.round(elevations[i] * 3.28084), // Convert meters to feet
            lat: c[1],
            lon: c[0]
        };
    });
}

/**
 * Rebuilds the elevation profile at the route's full point resolution by
 * linearly interpolating elevation between the sparse fetched samples.
 *
 * The sparse profile is deliberately coarse (one elevation lookup per few
 * dozen/hundred feet, capped independently to bound external elevation-API
 * cost — see fetchElevationData) — fine for the gain/loss calculation and
 * the visual chart line, but far too coarse for scrubbing the elevation
 * profile and watching the corresponding point move on the map: the
 * highlighted marker would jump directly between samples instead of
 * tracking the route. This produces a much denser set of hoverable
 * positions using geometry already in memory, with no extra network calls.
 */
const MIN_HOVER_GAP_MILES = 0.025;

export function densifyElevationProfile(
    routeCoords: [number, number][], // [lon, lat], full resolution
    sparseProfile: ElevationPoint[], // ascending distance (miles), from calculateElevationProfile
    maxPoints = 6000
): ElevationPoint[] {
    if (routeCoords.length === 0 || sparseProfile.length === 0) return sparseProfile;

    // Stride down if the full-res route has more points than maxPoints, to
    // bound chart-rendering cost while staying far denser than the sparse
    // elevation samples.
    const step = Math.max(1, Math.floor(routeCoords.length / maxPoints));
    const strided: [number, number][] = [];
    for (let i = 0; i < routeCoords.length; i += step) strided.push(routeCoords[i]);
    const lastCoord = routeCoords[routeCoords.length - 1];
    if (strided[strided.length - 1] !== lastCoord) strided.push(lastCoord);

    const segLengths: number[] = [0];
    let totalLength = 0;
    for (let i = 1; i < strided.length; i++) {
        const d = distance(point(strided[i - 1]), point(strided[i]), { units: 'miles' });
        segLengths.push(d);
        totalLength += d;
    }
    // Long straight streets have no vertices mid-block, so subdivide them or
    // hovering the chart skips hundreds of feet at a time.
    const maxGap = Math.max(MIN_HOVER_GAP_MILES, totalLength / maxPoints);

    let sparseIdx = 0; // two-pointer into sparseProfile, monotonic non-decreasing
    const dense: ElevationPoint[] = [];
    const pushAt = (lon: number, lat: number, cumulative: number) => {
        while (sparseIdx < sparseProfile.length - 2 && sparseProfile[sparseIdx + 1].distance <= cumulative) {
            sparseIdx++;
        }
        const a = sparseProfile[sparseIdx];
        const b = sparseProfile[Math.min(sparseIdx + 1, sparseProfile.length - 1)];
        const span = b.distance - a.distance;
        const t = span > 0 ? Math.max(0, Math.min(1, (cumulative - a.distance) / span)) : 0;
        dense.push({
            distance: parseFloat(cumulative.toFixed(3)),
            elevation: Math.round(a.elevation + (b.elevation - a.elevation) * t),
            lat,
            lon,
        });
    };

    let cumulative = 0;
    for (let i = 0; i < strided.length; i++) {
        if (i > 0) {
            const [lon0, lat0] = strided[i - 1];
            const [lon1, lat1] = strided[i];
            const segLength = segLengths[i];
            const pieces = Math.ceil(segLength / maxGap);
            for (let k = 1; k < pieces; k++) {
                const f = k / pieces;
                pushAt(lon0 + (lon1 - lon0) * f, lat0 + (lat1 - lat0) * f, cumulative + segLength * f);
            }
            cumulative += segLength;
        }
        pushAt(strided[i][0], strided[i][1], cumulative);
    }
    // The route's own cumulative distance can drift slightly from the sparse
    // profile's independently-summed total (different point spacing), which
    // would otherwise leave the very last point just short of t=1. Since both
    // represent the same physical endpoint, snap it to the sparse profile's
    // exact final elevation.
    if (dense.length > 0) dense[dense.length - 1].elevation = sparseProfile[sparseProfile.length - 1].elevation;
    return dense;
}
