import { boundsOf, boundsContain, routeCells, routeSimilarity, findMostCommonRide, waypointsAlong, waypointSpacingM, resolveAnchor, RideTrack, LOCAL_RADIUS_M } from './suggestRoute';
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
const ride = (poly: [number, number][], startDate = '2026-10-01T00:00:00Z', name = 'Ride'): RideTrack =>
    ({ id: nextId++, name, startDate, distanceM: 0, poly });

describe('routeSimilarity (#80)', () => {
    it('treats the same loop with GPS noise as the same route', () => {
        expect(routeSimilarity(routeCells(loop(3, 2)), routeCells(loop(3, 2, HOME, 0.00002)))).toBeGreaterThan(0.6);
    });

    it('does not treat a short ride inside a longer loop as the same route', () => {
        expect(routeSimilarity(routeCells(loop(1, 0.5)), routeCells(loop(6, 4)))).toBeLessThan(0.3);
    });
});

describe('findMostCommonRide (#80)', () => {
    it('picks the loop ridden most often, not a longer or shorter one-off', () => {
        const usual = [1, 2, 3, 4].map(k => ride(loop(3, 2, HOME, k * 0.00001), `2026-10-0${k}T00:00:00Z`, 'Usual loop'));
        const rides = [...usual, ride(loop(8, 5), '2026-10-09T00:00:00Z', 'Big day'), ride(loop(1, 0.5), '2026-10-08T00:00:00Z', 'Short spin')];
        const common = findMostCommonRide(rides, HOME)!;
        expect(common.ride.name).toBe('Usual loop');
        expect(common.timesRidden).toBe(4);
    });

    it('ignores rides that start far from the anchor', () => {
        const away = { lat: 40.76, lon: -111.89 }; // Salt Lake City
        const rides = [ride(loop(3, 2, away), '2026-10-01T00:00:00Z', 'Trip'), ride(loop(3, 2, away), '2026-10-02T00:00:00Z', 'Trip'), ride(loop(2, 2), '2026-09-01T00:00:00Z', 'Home')];
        expect(findMostCommonRide(rides, HOME)!.ride.name).toBe('Home');
        expect(findMostCommonRide(rides, away)!.ride.name).toBe('Trip');
        expect(haversineM(HOME.lat, HOME.lon, away.lat, away.lon)).toBeGreaterThan(LOCAL_RADIUS_M);
    });

    it('returns null with no local rides', () => {
        expect(findMostCommonRide([], HOME)).toBeNull();
    });

    it('prefers the most recent ride when nothing repeats', () => {
        const rides = [ride(loop(3, 2), '2026-09-01T00:00:00Z', 'Old'), ride(loop(1, 4), '2026-10-01T00:00:00Z', 'New')];
        expect(findMostCommonRide(rides, HOME)!.ride.name).toBe('New');
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

describe('waypointSpacingM / resolveAnchor (#80)', () => {
    it('keeps about a dozen legs within 1-3 km spacing', () => {
        expect(waypointSpacingM(24_000)).toBe(2000);
        expect(waypointSpacingM(5_000)).toBe(1000);
        expect(waypointSpacingM(100_000)).toBe(3000);
    });

    it('anchors at home unless the map is far away or there is no home', () => {
        const near = { lat: HOME.lat + 0.1, lon: HOME.lon };
        const far = { lat: 40.76, lon: -111.89 };
        expect(resolveAnchor(HOME, near)).toBe(HOME);
        expect(resolveAnchor(HOME, far)).toBe(far);
        expect(resolveAnchor(null, near)).toBe(near);
    });
});

describe('boundsOf / boundsContain (#80)', () => {
    it('wraps the points and checks the map view covers them', () => {
        const b = boundsOf([{ lat: 1, lon: 5 }, { lat: 3, lon: 2 }]);
        expect(b).toEqual({ south: 1, north: 3, west: 2, east: 5 });
        expect(boundsContain({ south: 0, north: 4, west: 1, east: 6 }, b)).toBe(true);
        expect(boundsContain({ south: 2, north: 4, west: 1, east: 6 }, b)).toBe(false);
    });
});
