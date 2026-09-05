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
    fetch(lats: string[], lons: string[]): Promise<number[]>;
}

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

// USGS 3DEP/NED, 10m resolution — far more accurate than SRTM's 30m integer-meter
// grid for the (US-only) routes this app targets. Verified against a real route's
// RWGPS numbers (728ft gain): SRTM30m naive-summed to 1263ft; NED10m naive-summed
// to 847ft, within ~30ft of RWGPS after the same hysteresis pass. Falls through to
// SRTM30m when a point falls outside NED's US coverage (Open Topo Data returns
// null elevations for out-of-bounds points rather than an error).
const NED10mProvider: ElevationProvider = {
    name: 'USGS NED 10m',
    batchSize: 100, // Public API limit
    async fetch(lats, lons) {
        const locations = lats.map((lat, i) => `${lat},${lons[i]}`).join('|');
        const url = `https://api.opentopodata.org/v1/ned10m?locations=${locations}`;
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (!data.results) throw new Error('Malformed response');
        const elevations = data.results.map((r: any) => r.elevation);
        if (elevations.some((e: number | null) => e === null)) throw new Error('Point outside NED10m coverage');
        return elevations;
    }
};

const OpenTopoDataProvider: ElevationProvider = {
    name: 'Open Topo Data (SRTM 30m)',
    batchSize: 100, // Public API limit
    async fetch(lats, lons) {
        const locations = lats.map((lat, i) => `${lat},${lons[i]}`).join('|');
        const url = `https://api.opentopodata.org/v1/srtm30m?locations=${locations}`;
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (!data.results) throw new Error('Malformed response');
        return data.results.map((r: any) => r.elevation);
    }
};

const PROVIDERS = [NED10mProvider, OpenTopoDataProvider, OpenMeteoProvider];

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

    const delay = (ms: number) => new Promise(res => setTimeout(res, ms));

    for (const provider of PROVIDERS) {
        try {
            console.log(`${ts()} Attempting elevation fetch with ${provider.name}...`);
            const finalElevations: number[] = [];

            for (let i = 0; i < sampledCoords.length; i += provider.batchSize) {
                const batchLats = lats.slice(i, i + provider.batchSize);
                const batchLons = lons.slice(i, i + provider.batchSize);

                let success = false;
                let retries = 0;
                const maxRetries = 3;

                while (!success && retries < maxRetries) {
                    try {
                        const elevations = await provider.fetch(batchLats, batchLons);
                        finalElevations.push(...elevations);
                        success = true;
                    } catch (err: any) {
                        if (err.message.includes('429')) {
                            const waitTime = Math.pow(2, retries) * 2000;
                            console.warn(`${ts()} ${provider.name} rate limited (429). Retrying in ${waitTime}ms...`);
                            await delay(waitTime);
                            retries++;
                        } else {
                            throw err;
                        }
                    }
                }

                if (!success) {
                    throw new Error(`Failed to fetch current batch from ${provider.name}`);
                }

                if (i + provider.batchSize < sampledCoords.length) {
                    await delay(500);
                }
            }

            console.log(`${ts()} Successfully fetched elevation from ${provider.name}`);
            return { elevations: finalElevations, sampledCoords };
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

    let cumulative = 0;
    let sparseIdx = 0; // two-pointer into sparseProfile, monotonic non-decreasing
    const dense: ElevationPoint[] = [];
    for (let i = 0; i < strided.length; i++) {
        if (i > 0) {
            cumulative += distance(point(strided[i - 1]), point(strided[i]), { units: 'miles' });
        }
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
            lat: strided[i][1],
            lon: strided[i][0],
        });
    }
    // The route's own cumulative distance can drift slightly from the sparse
    // profile's independently-summed total (different point spacing), which
    // would otherwise leave the very last point just short of t=1. Since both
    // represent the same physical endpoint, snap it to the sparse profile's
    // exact final elevation.
    if (dense.length > 0) dense[dense.length - 1].elevation = sparseProfile[sparseProfile.length - 1].elevation;
    return dense;
}
