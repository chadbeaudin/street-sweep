import { haversineM } from './geometry';

const METERS_PER_MILE = 1609.344;
const METERS_TO_FEET = 3.28084;

export interface RideRecords {
    totalDistanceMiles: number;
    longestRideMiles: number;
    biggestClimbFeet: number;
    activeDays: number;
    ridesPerYear: { year: number; rides: number; miles: number }[];
}

// Records/totals derived from per-activity summary data (no geocoding needed).
// Arrays are parallel: distances/elevations in meters, startDates ISO strings.
export function computeRideRecords(distancesM: number[], elevationsM: number[], startDates: string[]): RideRecords {
    let totalM = 0, longestM = 0, biggestClimbM = 0;
    const days = new Set<string>();
    const perYear = new Map<number, { rides: number; miles: number }>();

    for (let i = 0; i < distancesM.length; i++) {
        const d = distancesM[i] || 0;
        totalM += d;
        if (d > longestM) longestM = d;
        const e = elevationsM[i] || 0;
        if (e > biggestClimbM) biggestClimbM = e;

        const iso = startDates[i];
        if (iso) {
            days.add(iso.slice(0, 10)); // YYYY-MM-DD
            const year = Number(iso.slice(0, 4));
            if (year) {
                const y = perYear.get(year) ?? { rides: 0, miles: 0 };
                y.rides += 1;
                y.miles += d / METERS_PER_MILE;
                perYear.set(year, y);
            }
        }
    }

    return {
        totalDistanceMiles: totalM / METERS_PER_MILE,
        longestRideMiles: longestM / METERS_PER_MILE,
        biggestClimbFeet: biggestClimbM * METERS_TO_FEET,
        activeDays: days.size,
        ridesPerYear: Array.from(perYear.entries())
            .map(([year, v]) => ({ year, rides: v.rides, miles: v.miles }))
            .sort((a, b) => a.year - b.year),
    };
}

// Cell side ≈ 15m. Small enough to capture a single road segment without
// merging adjacent parallel roads; large enough that GPS noise on the same
// segment maps to the same cell across activities.
const CELL_METERS = 15;
const DEG_PER_METER = 1 / 111320;
const CELL_DEG = CELL_METERS * DEG_PER_METER;

export function quantizeCellKey(lat: number, lon: number): string {
    const cellLat = Math.floor(lat / CELL_DEG);
    const cellLon = Math.floor(lon / CELL_DEG);
    return `${cellLat}:${cellLon}`;
}

/**
 * Build the set of unique grid cells touched by all activity polylines.
 * Subdivides each segment so cells between sparse polyline vertices are
 * still counted (Strava summary_polylines can skip whole blocks).
 */
export function buildCoverageCells(riddenRoads: [number, number][][]): Set<string> {
    const cells = new Set<string>();
    for (const polyline of riddenRoads) {
        if (!polyline || polyline.length === 0) continue;
        cells.add(quantizeCellKey(polyline[0][0], polyline[0][1]));
        for (let i = 1; i < polyline.length; i++) {
            const [aLat, aLon] = polyline[i - 1];
            const [bLat, bLon] = polyline[i];
            const segMeters = haversineM(aLat, aLon, bLat, bLon);
            const steps = Math.max(1, Math.ceil(segMeters / CELL_METERS));
            for (let s = 1; s <= steps; s++) {
                const t = s / steps;
                cells.add(quantizeCellKey(aLat + (bLat - aLat) * t, aLon + (bLon - aLon) * t));
            }
        }
    }
    return cells;
}

export function cellsToMiles(cellCount: number): number {
    return (cellCount * CELL_METERS) / METERS_PER_MILE;
}

export function computeUniqueMiles(riddenRoads: [number, number][][]): number {
    return cellsToMiles(buildCoverageCells(riddenRoads).size);
}

/**
 * Build coverage cells from a road network represented as [lat, lon] polylines.
 * Same quantization as buildCoverageCells so the result is directly comparable
 * to a coverage set built from ridden activities.
 */
export function buildRoadNetworkCells(roads: [number, number][][]): Set<string> {
    return buildCoverageCells(roads);
}

export function pointInPolygon(lat: number, lon: number, polygon: [number, number][]): boolean {
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        const [iLat, iLon] = polygon[i];
        const [jLat, jLon] = polygon[j];
        const intersect = (iLon > lon) !== (jLon > lon) &&
            lat < (jLat - iLat) * (lon - iLon) / (jLon - iLon) + iLat;
        if (intersect) inside = !inside;
    }
    return inside;
}

export function polylineCentroid(polyline: [number, number][]): [number, number] | null {
    if (!polyline || polyline.length === 0) return null;
    let sumLat = 0, sumLon = 0;
    for (const [lat, lon] of polyline) { sumLat += lat; sumLon += lon; }
    return [sumLat / polyline.length, sumLon / polyline.length];
}

// Outdoor cycling types only. 'virtualride' (Zwift and other indoor trainers)
// is deliberately excluded: its GPS coordinates are fictional and land in
// random real countries, polluting coverage stats, geography, and the map.
// StreetSweep only cares about real roads ridden.
const BIKING_TYPES = new Set([
    'ride',
    'ebikeride',
    'gravelride',
    'mountainbikeride',
    'velomobile',
    'handcycle'
]);

export function isBikingActivity(type?: string): boolean {
    if (!type) return false; // Must have an explicit biking type
    return BIKING_TYPES.has(type.toLowerCase());
}
