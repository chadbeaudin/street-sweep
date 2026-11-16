import { haversineM } from './geometry';

// "Suggest a Route" (#80): find the ride the rider repeats most -- its distance and
// climbing are what a suggestion aims for (lib/suggestLoop.ts) -- and lay the chosen
// loop out as waypoints the client routes like clicked points.

export interface RideTrack {
    id: number;
    name: string;
    startDate: string;
    distanceM: number;
    elevationGainM: number;
    poly: [number, number][]; // [lat, lon]
}

export interface CommonRide {
    ride: RideTrack;
    timesRidden: number; // the ride itself plus the rides similar to it
}

// Coarse enough that GPS noise, lane changes and a decimated summary polyline
// of the same street still land in the same cells.
const SIMILARITY_CELL_M = 100;
// Two rides count as "the same route" at this overlap of their cells.
export const SAME_ROUTE_SIMILARITY = 0.6;
// Pairwise comparison is quadratic; the most recent rides best reflect current habits.
const MAX_RIDES_COMPARED = 400;
// Rides starting within this of the chosen start set the target; otherwise all rides do.
export const LOCAL_RADIUS_M = 15_000;

// Cell (y, x) packed into one number; |x| stays far below ROW for any longitude.
const ROW = 1_000_000;

export function routeCells(poly: [number, number][]): Set<number> {
    const cellDeg = SIMILARITY_CELL_M / 111_320;
    const key = (lat: number, lon: number) =>
        Math.floor(lat / cellDeg) * ROW + Math.floor(lon * Math.cos(lat * Math.PI / 180) / cellDeg);
    const cells = new Set<number>();
    for (let i = 0; i < poly.length; i++) {
        const [lat, lon] = poly[i];
        cells.add(key(lat, lon));
        if (i === 0) continue;
        const [pLat, pLon] = poly[i - 1];
        const steps = Math.ceil(haversineM(pLat, pLon, lat, lon) / (SIMILARITY_CELL_M / 2));
        for (let s = 1; s < steps; s++) {
            const t = s / steps;
            cells.add(key(pLat + (lat - pLat) * t, pLon + (lon - pLon) * t));
        }
    }
    return cells;
}

// The cells plus all their neighbours, so a street lying on a cell boundary
// still matches the same street on another ride.
function withNeighbours(cells: Set<number>): Set<number> {
    const out = new Set<number>();
    for (const c of cells) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) out.add(c + dy * ROW + dx);
    return out;
}

function countIn(cells: Set<number>, other: Set<number>): number {
    let n = 0;
    for (const c of cells) if (other.has(c)) n++;
    return n;
}

// Share of both rides' cells that the other ride passes through or next to. Symmetric.
export function routeSimilarity(a: Set<number>, b: Set<number>): number {
    const total = a.size + b.size;
    return total === 0 ? 0 : (countIn(a, withNeighbours(b)) + countIn(b, withNeighbours(a))) / total;
}

function pathLengthM(poly: [number, number][]): number {
    let m = 0;
    for (let i = 1; i < poly.length; i++) m += haversineM(poly[i - 1][0], poly[i - 1][1], poly[i][0], poly[i][1]);
    return m;
}

// Rides whose lengths differ more than this can't be the same route; skipping them keeps
// the pairwise comparison fast on a long ride history.
const MAX_LENGTH_RATIO = 2;

// The rider's most common ride starting within `radiusM` of `anchor`: the ride
// that the most other rides closely match. Similarity is symmetric, so a short
// ride that merely sits inside longer loops doesn't count as repeating them.
export function findMostCommonRide(rides: RideTrack[], anchor: { lat: number; lon: number }, radiusM = LOCAL_RADIUS_M): CommonRide | null {
    const local = rides
        .filter(r => r.poly.length >= 2 && haversineM(anchor.lat, anchor.lon, r.poly[0][0], r.poly[0][1]) <= radiusM)
        .sort((a, b) => b.startDate.localeCompare(a.startDate))
        .slice(0, MAX_RIDES_COMPARED);
    if (local.length === 0) return null;

    const cells = local.map(r => routeCells(r.poly));
    const near = cells.map(withNeighbours);
    const lengths = local.map(r => pathLengthM(r.poly));
    const matches = new Array(local.length).fill(0);
    for (let i = 0; i < local.length; i++) {
        for (let j = i + 1; j < local.length; j++) {
            if (Math.max(lengths[i], lengths[j]) > MAX_LENGTH_RATIO * Math.min(lengths[i], lengths[j])) continue;
            const similarity = (countIn(cells[i], near[j]) + countIn(cells[j], near[i])) / (cells[i].size + cells[j].size);
            if (similarity >= SAME_ROUTE_SIMILARITY) {
                matches[i]++;
                matches[j]++;
            }
        }
    }

    // Ties go to the more recent ride (local is newest first).
    let best = 0;
    for (let i = 1; i < local.length; i++) if (matches[i] > matches[best]) best = i;
    return { ride: local[best], timesRidden: matches[best] + 1 };
}

// Rides that end where they started get the start repeated as the last point.
const LOOP_CLOSE_M = 300;

// Points every `spacingM` along the path, always including both ends.
export interface RouteLegs {
    waypoints: { lat: number; lon: number }[];
    legs: [number, number][][]; // [lon, lat], one per pair of neighbouring waypoints, as /api/step returns paths
}

// Cuts a routed path into waypoints about `spacingM` apart and the stretch of path between
// each pair, so the client can show the route without routing it a second time (#224).
export function legsAlong(poly: [number, number][], spacingM: number): RouteLegs {
    if (poly.length === 0) return { waypoints: [], legs: [] };
    const waypoints = [{ lat: poly[0][0], lon: poly[0][1] }];
    const legs: [number, number][][] = [];
    let leg: [number, number][] = [[poly[0][1], poly[0][0]]];
    let sinceLast = 0;
    for (let i = 1; i < poly.length; i++) {
        let [aLat, aLon] = poly[i - 1];
        const [bLat, bLon] = poly[i];
        let remaining = haversineM(aLat, aLon, bLat, bLon);
        while (sinceLast + remaining >= spacingM) {
            const t = (spacingM - sinceLast) / remaining;
            aLat += (bLat - aLat) * t;
            aLon += (bLon - aLon) * t;
            waypoints.push({ lat: aLat, lon: aLon });
            leg.push([aLon, aLat]);
            legs.push(leg);
            leg = [[aLon, aLat]];
            remaining -= spacingM - sinceLast;
            sinceLast = 0;
        }
        sinceLast += remaining;
        leg.push([bLon, bLat]);
    }
    const [endLat, endLon] = poly[poly.length - 1];
    const start = waypoints[0];
    const end = haversineM(start.lat, start.lon, endLat, endLon) <= LOOP_CLOSE_M ? start : { lat: endLat, lon: endLon };
    const last = waypoints[waypoints.length - 1];
    // A waypoint that landed just before the end would only make a tiny leg; fold it into the one before.
    if (waypoints.length > 1 && haversineM(last.lat, last.lon, end.lat, end.lon) < spacingM / 3) {
        waypoints.pop();
        leg = [...legs.pop()!, ...leg.slice(1)];
    }
    waypoints.push(end);
    legs.push(leg);
    return { waypoints, legs };
}

export function waypointsAlong(poly: [number, number][], spacingM: number): { lat: number; lon: number }[] {
    return legsAlong(poly, spacingM).waypoints;
}

export function waypointSpacingM(distanceM: number): number {
    return Math.min(3000, Math.max(1000, distanceM / 12));
}

type Bounds = { south: number; west: number; north: number; east: number };

export function boundsOf(points: { lat: number; lon: number }[]): Bounds {
    return {
        south: Math.min(...points.map(p => p.lat)),
        north: Math.max(...points.map(p => p.lat)),
        west: Math.min(...points.map(p => p.lon)),
        east: Math.max(...points.map(p => p.lon)),
    };
}

// The suggested loop as ordinary route points: each waypoint already sits on the road,
// and leg i joins point i to point i + 1, the shape the page keeps clicked routes in.
export function placeSuggestedRoute(waypoints: { lat: number; lon: number }[], legs: [number, number][][]) {
    return {
        points: waypoints.map(p => ({ ...p, id: Math.random().toString(36).slice(2, 11), status: 'snapped' as const })),
        route: legs.slice(0, Math.max(0, waypoints.length - 1)),
    };
}
