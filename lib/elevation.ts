// Elevation profile math, shared by the browser (app/page.tsx) and the server.
// Fetching elevations from providers lives in lib/elevationFetch.ts so this
// file stays free of server-only imports.
import distance from '@turf/distance';
import { point } from '@turf/helpers';

export interface ElevationPoint {
    distance: number;
    elevation: number;
    lat: number;
    lon: number;
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
