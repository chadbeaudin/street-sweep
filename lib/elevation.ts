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

const OpenTopoDataProvider: ElevationProvider = {
    name: 'Open Topo Data',
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

const PROVIDERS = [OpenTopoDataProvider, OpenMeteoProvider];

/**
 * Fetches elevation data for a list of coordinates using multiple fallback providers.
 */
export async function fetchElevationData(coordinates: [number, number][]): Promise<{ elevations: number[], sampledCoords: [number, number][] }> {
    if (coordinates.length === 0) return { elevations: [], sampledCoords: [] };

    let totalMiles = 0;
    for (let i = 1; i < coordinates.length; i++) {
        totalMiles += distance(point(coordinates[i - 1]), point(coordinates[i]), { units: 'miles' });
    }

    const pointsPerMile = 200; // Doubled from 99 for more granular hover tracking
    let targetPoints = Math.max(50, Math.min(1000, Math.round(totalMiles * pointsPerMile)));
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
