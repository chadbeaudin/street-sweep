import { boundsOf, placeSuggestedRoute, legsAlong, findTypicalRide, waypointsAlong, waypointSpacingM, RideTrack } from './suggestRoute';
import { haversineM } from './geometry';

const HOME = { lat: 47.65, lon: -117.42 };
const DEG_PER_KM = 1 / 111.32;

// A rectangular loop from home, `w` km east and `h` km north, sampled every ~50 m.
function loop(w: number, h: number, origin = HOME, jitter = 0): [number, number][] {
    const lonPerKm = DEG_PER_KM / Math.cos(origin.lat * Math.PI / 180);
    const corners: [number, number][] = [[0, 0], [0, w], [h, w], [h, 0], [0, 0]];
    const pts: [number, number][] = [];
    for (let c = 1; c < corners.length; c++) {
        const [y0, x0] = corners[c - 1], [y1, x1] = corners[c];
        const steps = Math.max(1, Math.round(Math.hypot(y1 - y0, x1 - x0) / 0.05));
        for (let s = 0; s < steps; s++) {
            const t = s / steps;
            pts.push([origin.lat + (y0 + (y1 - y0) * t) * DEG_PER_KM + jitter, origin.lon + (x0 + (x1 - x0) * t) * lonPerKm + jitter]);
        }
    }
    pts.push([origin.lat + jitter, origin.lon + jitter]);
    return pts;
}

let nextId = 1;
const MI = 1609.344, FT = 0.3048;
const ride = (miles: number, feet: number, startDate = '2026-10-01T00:00:00Z', name = 'Ride', at = HOME): RideTrack =>
    ({ id: nextId++, name, startDate, distanceM: miles * MI, elevationGainM: feet * FT, poly: loop(1, 1, at) });
const NOW = Date.parse('2026-11-16T00:00:00Z');

describe('findTypicalRide (#237)', () => {
    it("picks the ride closest to the rider's median distance and climbing", () => {
        const rides = [ride(8, 300), ride(20, 1500), ride(28, 1800, '2026-10-02T00:00:00Z', 'Usual'), ride(29, 1900), ride(30, 1700), ride(55, 4000)];
        // Medians: 28.5 mi, 1750 ft.
        expect(findTypicalRide(rides, NOW)!.name).toBe('Usual');
    });

    it('ignores where the rides were, so one-off rides near the start do not set the target', () => {
        const nearStart = { lat: 47.72, lon: -117.54 };
        const rides = [ride(8.3, 900, '2026-11-10T00:00:00Z', 'Short one-off', nearStart),
            ...[1, 2, 3, 4, 5].map(d => ride(21, 1500, `2026-10-0${d}T00:00:00Z`, 'Usual', HOME))];
        expect(findTypicalRide(rides, NOW)!.name).toBe('Usual');
    });

    it('judges habits from the past year, unless that year has too few rides', () => {
        const old = [1, 2, 3, 4, 5].map(d => ride(27, 1600, `2022-03-0${d}T00:00:00Z`, 'Old habit'));
        const recent = [1, 2, 3, 4, 5].map(d => ride(21, 1400, `2026-10-0${d}T00:00:00Z`, 'This year'));
        expect(findTypicalRide([...old, ...recent], NOW)!.name).toBe('This year');
        expect(findTypicalRide([...old, recent[0]], NOW)!.name).toBe('Old habit');
    });

    it('returns nothing without usable rides', () => {
        expect(findTypicalRide([], NOW)).toBeNull();
        expect(findTypicalRide([{ ...ride(20, 1000), poly: [] }], NOW)).toBeNull();
    });
});

describe('waypointsAlong (#80)', () => {
    it('spaces points evenly and closes a loop back at its start', () => {
        const pts = waypointsAlong(loop(3, 2), 1000); // 10 km loop
        expect(pts[0]).toEqual(pts[pts.length - 1]);
        expect(pts.length).toBeGreaterThanOrEqual(10);
        expect(pts.length).toBeLessThanOrEqual(11);
        for (let i = 1; i < pts.length - 1; i++) {
            expect(haversineM(pts[i - 1].lat, pts[i - 1].lon, pts[i].lat, pts[i].lon)).toBeLessThan(1050);
        }
    });

    it('ends at the far end of a point-to-point ride', () => {
        const line: [number, number][] = [[47.65, -117.42], [47.65 + 5 * DEG_PER_KM, -117.42]];
        const pts = waypointsAlong(line, 1000);
        expect(pts[pts.length - 1]).toEqual({ lat: line[1][0], lon: line[1][1] });
        expect(pts).toHaveLength(6);
    });
});

describe('waypointSpacingM (#80)', () => {
    it('keeps about a dozen legs within 1-3 km spacing', () => {
        expect(waypointSpacingM(24_000)).toBe(2000);
        expect(waypointSpacingM(5_000)).toBe(1000);
        expect(waypointSpacingM(100_000)).toBe(3000);
    });
});

describe('boundsOf (#80)', () => {
    it('wraps the points', () => {
        expect(boundsOf([{ lat: 1, lon: 5 }, { lat: 3, lon: 2 }])).toEqual({ south: 1, north: 3, west: 2, east: 5 });
    });
});

describe('legsAlong (#224)', () => {
    const pathLengthM = (leg: [number, number][]) => leg.slice(1).reduce((sum, p, i) => sum + haversineM(leg[i][1], leg[i][0], p[1], p[0]), 0);

    it('gives one leg per pair of waypoints, each starting and ending on them', () => {
        const { waypoints, legs } = legsAlong(loop(3, 2), 1000);
        expect(legs).toHaveLength(waypoints.length - 1);
        legs.forEach((leg, i) => {
            expect(leg[0]).toEqual([waypoints[i].lon, waypoints[i].lat]);
            if (i < legs.length - 1) expect(leg[leg.length - 1]).toEqual([waypoints[i + 1].lon, waypoints[i + 1].lat]);
        });
    });

    it('covers the whole path, so the legs add up to its length', () => {
        const path = loop(3, 2);
        const total = path.slice(1).reduce((sum, p, i) => sum + haversineM(path[i][0], path[i][1], p[0], p[1]), 0);
        const { legs } = legsAlong(path, 1000);
        expect(legs.reduce((sum, leg) => sum + pathLengthM(leg), 0)).toBeCloseTo(total, 3);
    });

    it('folds a tiny last leg into the one before it', () => {
        const line: [number, number][] = [[47.65, -117.42], [47.65 + 2.1 * DEG_PER_KM, -117.42]];
        const { waypoints, legs } = legsAlong(line, 1000);
        expect(waypoints).toHaveLength(3); // 0, 1 km, and the end at 2.1 km
        expect(legs).toHaveLength(2);
        expect(pathLengthM(legs[1])).toBeCloseTo(1100, -1);
    });
});

describe('placeSuggestedRoute (#224)', () => {
    it('turns waypoints into snapped route points with their legs between them', () => {
        const { waypoints, legs } = legsAlong(loop(3, 2), 1000);
        const placed = placeSuggestedRoute(waypoints, legs);
        expect(placed.points).toHaveLength(waypoints.length);
        expect(placed.points.every(p => p.status === 'snapped' && p.id.length > 0)).toBe(true);
        expect(new Set(placed.points.map(p => p.id)).size).toBe(waypoints.length);
        expect(placed.route).toEqual(legs);
    });
});
