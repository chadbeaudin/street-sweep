import { haversineM } from './geometry';

// "Suggest a Route" (#80): find the rider's typical ride -- its distance and climbing
// are what a suggestion aims for (lib/suggestLoop.ts) -- and lay the chosen loop out
// as waypoints with the routed legs between them.

export interface RideTrack {
    id: number;
    name: string;
    startDate: string;
    distanceM: number;
    elevationGainM: number;
    poly: [number, number][]; // [lat, lon]
}

// What the rider usually rides is judged from the past year; older habits may not hold.
const TYPICAL_WINDOW_MS = 365 * 24 * 60 * 60 * 1000;
// Fewer recent rides than this say too little, so the whole history is used instead.
const MIN_RECENT_RIDES = 5;
// Climbing differences below this don't count for much, so a flat rider's medians stay comparable.
const MIN_GAIN_SCALE_M = 60;

const median = (values: number[]) => {
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

// The rider's typical ride, wherever it was (#237): the ride closest to the median
// distance and climbing of their past year of rides. A real ride stands in for the medians
// so its climbing can be measured from map elevation, the same way as the candidate loops'.
export function findTypicalRide(rides: RideTrack[], now = Date.now()): RideTrack | null {
    const usable = rides.filter(r => r.poly.length >= 2 && r.distanceM > 0);
    if (usable.length === 0) return null;
    const cutoff = new Date(now - TYPICAL_WINDOW_MS).toISOString();
    const recent = usable.filter(r => r.startDate >= cutoff);
    const pool = recent.length >= MIN_RECENT_RIDES ? recent : usable;

    const distanceM = median(pool.map(r => r.distanceM));
    const gainM = median(pool.map(r => r.elevationGainM));
    const gainScale = Math.max(gainM, MIN_GAIN_SCALE_M);
    const offBy = (r: RideTrack) => Math.abs(r.distanceM - distanceM) / distanceM + Math.abs(r.elevationGainM - gainM) / gainScale;
    // Ties go to the most recent ride.
    return [...pool].sort((a, b) => offBy(a) - offBy(b) || b.startDate.localeCompare(a.startDate))[0];
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
