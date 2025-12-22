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

    // Limit to 100 points to stay within single request limit and avoid 429s
    const maxPoints = 100;
    const sampledCoords: [number, number][] = [];

    if (coordinates.length <= maxPoints) {
        sampledCoords.push(...coordinates);
    } else {
        const step = (coordinates.length - 1) / (maxPoints - 1);
        for (let i = 0; i < maxPoints; i++) {
            const index = Math.round(i * step);
            sampledCoords.push(coordinates[index]);
        }
    }

    const lats = sampledCoords.map(c => c[1]).join(',');
    const lons = sampledCoords.map(c => c[0]).join(',');
    const url = `https://api.open-meteo.com/v1/elevation?latitude=${lats}&longitude=${lons}`;

    try {
        const res = await fetch(url);
        if (!res.ok) {
            const errorText = await res.text();
            console.error('Elevation API error:', res.status, errorText);
            throw new Error(`Elevation API returned ${res.status}: ${errorText}`);
        }

        const data = await res.json();
        if (data && data.elevation) {
            return { elevations: data.elevation, sampledCoords };
        } else {
            throw new Error('Malformed elevation data response');
        }
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
