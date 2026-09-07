import { dedupeRiddenRoads, combineRiddenOverlay, filterRiddenRoadsToBbox } from './riddenRoads';

// ~111320m per degree of latitude, used to build roads/traces at known real-world distances.
const M_PER_DEG_LAT = 111320;
const metersToLatDeg = (m: number) => m / M_PER_DEG_LAT;

describe('dedupeRiddenRoads', () => {
    it('does not mark a short intersection spur as ridden from GPS jitter while cornering, without actually turning onto it', () => {
        // Main road running north-south through (0, 0).
        const mainRoad: [number, number][] = [[-0.01, 0], [0, 0], [0.01, 0]];
        // A short spur (~20m) branching east from the intersection.
        const spurLenDeg = metersToLatDeg(20);
        const spur: [number, number][] = [[0, 0], [0, spurLenDeg]];

        // Rider travels the main road and takes the corner a little wide (GPS jitter/lean),
        // clipping ~2m into the spur's territory at roughly its 40%-length point, but never
        // actually turns onto it — the trace continues straight up the main road.
        const jitterOffsetLat = metersToLatDeg(2);
        const ride: [number, number][] = [
            [-0.005, 0],
            [0, 0],
            [jitterOffsetLat, spurLenDeg * 0.4],
            [0.005, 0],
        ];

        const result = dedupeRiddenRoads([ride], [mainRoad, spur]);
        const hitSpur = result.some(seg => seg.some(([, lon]) => lon > 0));
        expect(hitSpur).toBe(false);
    });

    it('regression: marks a road ridden when the GPS trace runs ~35m off it the whole way (real-world corner-cutting/drift)', () => {
        // A single ~180m road. Real riders don't trace a road's exact geometry --
        // cutting corners at intersections or drifting under tree/building cover --
        // so a genuinely-ridden street's GPS trace can sit tens of meters off the
        // road's own line for its entire length, not just near a turn. At the old
        // 20m tolerance this road would be missed entirely; two such streets meeting
        // at a corner, each losing their tolerance-adjacent length, is what showed up
        // as a visible gap where ridden streets should have connected on the map.
        const road: [number, number][] = [[0, 0], [0, metersToLatDeg(180)]];

        // Trace runs parallel to the road, offset 35m to one side for its whole length.
        const offset = metersToLatDeg(35);
        const ride: [number, number][] = [[offset, 0], [offset, metersToLatDeg(180)]];

        const result = dedupeRiddenRoads([ride], [road]);
        const coveredLength = result.reduce((sum, seg) => sum + Math.abs(seg[seg.length - 1][1] - seg[0][1]) * M_PER_DEG_LAT, 0);

        // Should cover (most of) the full 180m road -- not zero, as it would have
        // under the old 20m tolerance.
        expect(coveredLength).toBeGreaterThan(150);
    });

    it('regression: snaps a ridden run to its street\'s own endpoint when covered to within 20m of it (closes intersection gaps)', () => {
        // Each OSM way is its own entry in `roads` and matched independently, so a
        // run that covers everything except the last ~15m before the way's terminal
        // node (where it meets the next street) previously left a visible gap right
        // at the intersection, even with plenty of real coverage on both sides.
        const road: [number, number][] = [
            [0, 0],
            [0, metersToLatDeg(185)],
            [0, metersToLatDeg(200)], // true endpoint -- e.g. where it meets a cross street
        ];
        const ride: [number, number][] = [[0, 0], [0, metersToLatDeg(185)]];

        const result = dedupeRiddenRoads([ride], [road]);
        const reachesEndpoint = result.some(seg => seg.some(([, lon]) => Math.abs(lon - metersToLatDeg(200)) < 1e-9));
        expect(reachesEndpoint).toBe(true);
    });

    it('does not snap a run to the endpoint when the uncovered gap is too large to assume it connects', () => {
        const road: [number, number][] = [
            [0, 0],
            [0, metersToLatDeg(160)],
            [0, metersToLatDeg(200)], // 40m past the last covered point -- a real gap
        ];
        const ride: [number, number][] = [[0, 0], [0, metersToLatDeg(160)]];

        const result = dedupeRiddenRoads([ride], [road]);
        const reachesEndpoint = result.some(seg => seg.some(([, lon]) => Math.abs(lon - metersToLatDeg(200)) < 1e-9));
        expect(reachesEndpoint).toBe(false);
    });

    it('regression: bridges a short uncovered gap between two covered runs in the middle of the same way (brief GPS dropout)', () => {
        // A 200m way covered at both ends but with a 15m unmatched stretch in the
        // middle -- e.g. a brief GPS signal dropout under tree cover mid-street, not
        // two genuinely separate rides that both stopped short of the same spot.
        const road: [number, number][] = [
            [0, 0],
            [0, metersToLatDeg(90)],
            [0, metersToLatDeg(105)], // 15m unmatched stretch
            [0, metersToLatDeg(200)],
        ];
        const ride: [number, number][] = [
            [0, 0], [0, metersToLatDeg(90)],
            [0, metersToLatDeg(105)], [0, metersToLatDeg(200)],
        ];
        // Trim the "GPS" so nothing is recorded across the 90m-105m stretch.
        // (dedupeRiddenRoads densifies between consecutive ride points, so split
        // the ride into two separate traces to leave a real recording gap.)
        const result = dedupeRiddenRoads([[[0, 0], [0, metersToLatDeg(90)]], [[0, metersToLatDeg(105)], [0, metersToLatDeg(200)]]], [road]);

        const coversPoint = (lon: number) => result.some(seg => seg.some(([, lo]) => Math.abs(lo - lon) < 1e-9));
        expect(coversPoint(0)).toBe(true);
        expect(coversPoint(metersToLatDeg(200))).toBe(true);
        // The single output run should span the full way -- the 15m gap bridged in,
        // not left as two disconnected pieces.
        expect(result.length).toBe(1);
    });

    it('does not bridge a genuine mid-way gap wider than the bridge threshold', () => {
        const road: [number, number][] = [
            [0, 0],
            [0, metersToLatDeg(90)],
            [0, metersToLatDeg(390)], // 300m genuinely unridden stretch
            [0, metersToLatDeg(500)],
        ];
        // Traces stop well clear (>TOLERANCE_M) of the unridden stretch's own
        // boundary vertices, so a trace's own endpoint can't leak into that
        // segment's coverage via the tolerance/vertex-sharing edge case that a
        // trace ending exactly AT a road vertex would trigger.
        const result = dedupeRiddenRoads([[[0, 0], [0, metersToLatDeg(20)]], [[0, metersToLatDeg(460)], [0, metersToLatDeg(500)]]], [road]);
        expect(result.length).toBe(2);
    });

    it('marks a spur as ridden when the rider actually turns onto it', () => {
        const mainRoad: [number, number][] = [[-0.01, 0], [0, 0], [0.01, 0]];
        const spurLenDeg = metersToLatDeg(20);
        const spur: [number, number][] = [[0, 0], [0, spurLenDeg]];

        // Rider comes up the main road and turns onto the full spur.
        const ride: [number, number][] = [[-0.005, 0], [0, 0], [0, spurLenDeg]];

        const result = dedupeRiddenRoads([ride], [mainRoad, spur]);
        const hitSpur = result.some(seg => seg.some(([, lon]) => lon > 0));
        expect(hitSpur).toBe(true);
    });
});

describe('combineRiddenOverlay', () => {
    const precomputed: [number, number][][] = [[[0, 0], [0, 0.001]]];
    const fresh: [number, number][][] = [[[1, 1], [1, 1.001]]];

    it('unions precomputed and fresh roads when both are present — a fresh road never disappears', () => {
        const result = combineRiddenOverlay(precomputed, fresh);
        expect(result).toEqual([...precomputed, ...fresh]);
    });

    it('returns precomputed alone when there is no fresh data yet', () => {
        expect(combineRiddenOverlay(precomputed, [])).toEqual(precomputed);
    });

    it('falls back to fresh data when precomputed is not available yet', () => {
        expect(combineRiddenOverlay(null, fresh)).toEqual(fresh);
        expect(combineRiddenOverlay(undefined, fresh)).toEqual(fresh);
        expect(combineRiddenOverlay([], fresh)).toEqual(fresh);
    });

    it('returns empty when neither source has data', () => {
        expect(combineRiddenOverlay(null, [])).toEqual([]);
        expect(combineRiddenOverlay([], [])).toEqual([]);
    });
});

describe('filterRiddenRoadsToBbox', () => {
    const bbox = { north: 1, south: 0, east: 1, west: 0 };

    it('keeps an activity with a point inside the bbox', () => {
        const roads: [number, number][][] = [[[0.5, 0.5], [0.6, 0.6]]];
        expect(filterRiddenRoadsToBbox(roads, bbox)).toEqual(roads);
    });

    it('keeps an activity within the padding threshold outside the bbox', () => {
        const roads: [number, number][][] = [[[1.0001, 0.5]]];
        expect(filterRiddenRoadsToBbox(roads, bbox, 50)).toEqual(roads);
    });

    it('drops an activity entirely outside the bbox and padding', () => {
        const roads: [number, number][][] = [[[10, 10], [11, 11]]];
        expect(filterRiddenRoadsToBbox(roads, bbox, 50)).toEqual([]);
    });

    it('keeps a whole activity, unmodified, when any point matches', () => {
        const roads: [number, number][][] = [[[10, 10], [0.5, 0.5], [20, 20]]];
        expect(filterRiddenRoadsToBbox(roads, bbox)).toEqual(roads);
    });

    it('passes through null/empty input', () => {
        expect(filterRiddenRoadsToBbox(null, bbox)).toBeNull();
        expect(filterRiddenRoadsToBbox(undefined, bbox)).toBeNull();
        expect(filterRiddenRoadsToBbox([], bbox)).toEqual([]);
    });

    it('drops a large out-of-area history down to what actually overlaps, mirroring the server-side filter', () => {
        // Regression coverage for the client-side freeze: JSON.stringify-ing years
        // of ride history on every map click blocked the main thread ("Page
        // Unresponsive") before the request even left the browser. Only history
        // near the request bbox should survive.
        const nearby: [number, number][] = [[0.5, 0.5], [0.51, 0.51]];
        const farAway: [number, number][] = [[45, -100], [45.01, -99.99]];
        const history: [number, number][][] = Array.from({ length: 200 }, (_, i) =>
            i === 0 ? nearby : farAway
        );
        const result = filterRiddenRoadsToBbox(history, bbox);
        expect(result).toEqual([nearby]);
    });
});
