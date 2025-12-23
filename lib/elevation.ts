import distance from '@turf/distance';
import { point } from '@turf/helpers';

export interface ElevationPoint {
    distance: number;
    elevation: number;
    lat: number;
    lon: number;
}

/**
 * Fetches elevation data for a list of coordinates using the Open-Meteo API.
 * Samples coordinates if they exceed 100 to avoid multiple batches and rate limits.
 */
export async function fetchElevationData(coordinates: [number, number][]): Promise<{ elevations: number[], sampledCoords: [number, number][] }> {
    if (coordinates.length === 0) return { elevations: [], sampledCoords: [] };

    // Calculate total distance to determine sample size based on density
    let totalMiles = 0;
    for (let i = 1; i < coordinates.length; i++) {
        totalMiles += distance(point(coordinates[i - 1]), point(coordinates[i]), { units: 'miles' });
    }

    // Fidelity: 100 points per mile, but between 50 and 1000 total points
    const pointsPerMile = 100;
    let targetPoints = Math.max(50, Math.min(1000, Math.round(totalMiles * pointsPerMile)));

    // Ensure we don't try to sample more points than we have
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

    // Batch requests to avoid "414 Request-URI Too Large"
    // even with 1000 points, we chunk them into 100 at a time
    const batchSize = 100;
    const finalElevations: number[] = [];

    try {
        for (let i = 0; i < sampledCoords.length; i += batchSize) {
            const batchLats = lats.slice(i, i + batchSize).join(',');
            const batchLons = lons.slice(i, i + batchSize).join(',');
            const url = `https://api.open-meteo.com/v1/elevation?latitude=${batchLats}&longitude=${batchLons}`;

            const res = await fetch(url);
            if (!res.ok) {
                const errorText = await res.text();
                console.error('Elevation API error:', res.status, errorText);
                throw new Error(`Elevation API returned ${res.status} for batch ${i / batchSize}`);
            }

            const data = await res.json();
            if (data && data.elevation) {
                finalElevations.push(...data.elevation);
            } else {
                throw new Error('Malformed elevation data response');
            }
        }
        return { elevations: finalElevations, sampledCoords };
    } catch (err) {
        console.error('Elevation fetch failed:', err);
        throw err;
    }
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
