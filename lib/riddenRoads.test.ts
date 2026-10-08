import { dedupeRiddenRoads, combineRiddenOverlay, filterRiddenRoadsToBbox, fillUnbranchedGaps } from './riddenRoads';

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

    it('regression: does not mark a longer dead-end spur ridden just because a straight-through main-road trace passes within tolerance of it', () => {
        // Real-world bug: a short perpendicular dead-end street (not just an
        // intersection-corner jitter) sat entirely within TOLERANCE_M (50m) of a
        // straight GPS trace along the main road it branches off of, so proximity
        // alone credited the whole spur as ridden even though the rider never
        // turned onto it -- rendered on the map as a short blue tick jutting off
        // the main ridden line.
        const mainRoad: [number, number][] = [[-0.01, 0], [0, 0], [0.01, 0]];
        // ~40m dead-end spur branching east from the intersection -- long enough
        // to clear MIN_COVERED_M, and its far tip is still within 50m of the main
        // road's own line.
        const spurLenDeg = metersToLatDeg(40);
        const spur: [number, number][] = [[0, 0], [0, spurLenDeg]];

        // Rider rides straight through the main road -- no jitter, no turn.
        const ride: [number, number][] = [[-0.01, 0], [0, 0], [0.01, 0]];

        const result = dedupeRiddenRoads([ride], [mainRoad, spur]);
        const hitSpur = result.some(seg => seg.some(([, lon]) => lon > 0));
        expect(hitSpur).toBe(false);
    });

    it('regression: does not mark a spur ridden when OSM splits it into several short way-segments near the intersection', () => {
        // Real-world bug (harder variant): OSM commonly splits a short physical
        // spur into several tiny way-segments a few meters each near an
        // intersection. Each such short segment's own two endpoints sit close
        // together, both well within reach of a dense main-road GPS trace passing
        // the intersection -- even though the rider never turned off the main
        // road. Each segment must independently reject the false credit, not just
        // a single long spur.
        const mainRoad: [number, number][] = [[-0.01, 0], [0, 0], [0.01, 0]];
        const m = metersToLatDeg;
        const spurSegments: [number, number][] = [[0, 0], [0, m(8)], [0, m(16)], [0, m(24)]];

        const ride: [number, number][] = [[-0.01, 0], [0, 0], [0.01, 0]];

        const result = dedupeRiddenRoads([ride], [mainRoad, spurSegments]);
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

    it('does not bridge a genuine mid-way gap wider than both the bridge and gap-fill thresholds', () => {
        const road: [number, number][] = [
            [0, 0],
            [0, metersToLatDeg(90)],
            [0, metersToLatDeg(590)], // 500m genuinely unridden stretch, past MAX_GAP_FILL_M
            [0, metersToLatDeg(700)],
        ];
        // Traces stop well clear (>TOLERANCE_M) of the unridden stretch's own
        // boundary vertices, so a trace's own endpoint can't leak into that
        // segment's coverage via the tolerance/vertex-sharing edge case that a
        // trace ending exactly AT a road vertex would trigger.
        const result = dedupeRiddenRoads([[[0, 0], [0, metersToLatDeg(20)]], [[0, metersToLatDeg(660)], [0, metersToLatDeg(700)]]], [road]);
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

    it('regression: does not credit a genuinely different, roughly-parallel road running close to the real one for part of its length', () => {
        // Real-world bug: a short stretch of a completely different (but nearby,
        // similarly-oriented) trail got credited as ridden because it ran within
        // TOLERANCE_M of the real ridden road for part of its length -- the bearing
        // check alone can't catch this, since a parallel road shares the real
        // road's own bearing by definition. Only picking the single closest
        // candidate per GPS point (not crediting every candidate within
        // tolerance) fixes it.
        const realRoad: [number, number][] = [[0, 0], [0, metersToLatDeg(500)]];
        // A different trail, mostly far away, but drifting within ~15m of the real
        // road for one ~150m stretch in the middle -- close enough to satisfy
        // TOLERANCE_M there even though it's the wrong road.
        const nearbyTrail: [number, number][] = [
            [metersToLatDeg(200), metersToLatDeg(200)],
            [metersToLatDeg(15), metersToLatDeg(240)],
            [metersToLatDeg(15), metersToLatDeg(390)],
            [metersToLatDeg(200), metersToLatDeg(430)],
        ];

        // Rider rides the real road start to finish.
        const ride: [number, number][] = [[0, 0], [0, metersToLatDeg(500)]];

        const result = dedupeRiddenRoads([ride], [realRoad, nearbyTrail]);
        const hitTrail = result.some(seg => seg.some(([lat]) => lat > metersToLatDeg(5)));
        expect(hitTrail).toBe(false);
    });

    it('regression: a fully-ridden curvy road split into many OSM way-segments stays one continuous covered run', () => {
        // Real-world bug: the closest-candidate-only fix above, applied with a strict
        // single winner and no tie margin, over-corrected. A long physical road is
        // typically split by OSM into many short, individually-numbered way entries
        // (one per intersection/vertex), and a real GPS trace never sits exactly on
        // the road's own line -- it drifts a few meters to one side. At each bend,
        // which of the two neighboring way-segments is "closest" to an off-line point
        // can flip based on which side of the bend the point falls, starving whichever
        // segment loses most of its own nearby points of enough matches to individually
        // clear MIN_COVERED_M -- a fully-ridden curvy road (e.g. a real rider's Sand
        // Flats Road / CR 82) then rendered as a broken dashed line instead of one
        // continuous ridden stretch.
        const m = metersToLatDeg;
        // A gently curving road, each ~15m stretch its own separate way entry (as OSM
        // commonly splits at a real vertex), overall heading east while wiggling
        // slightly north/south.
        const roads: [number, number][][] = [];
        const vertices: [number, number][] = [];
        for (let i = 0; i <= 20; i++) vertices.push([m(i % 2 === 0 ? 0 : 3), m(i * 15)]);
        for (let i = 0; i < vertices.length - 1; i++) roads.push([vertices[i], vertices[i + 1]]);

        // Rider's real GPS trace drifts a constant 3m to one side of the road's own
        // line the whole way -- realistic corner-cutting/drift, not a perfect trace.
        const ride: [number, number][] = vertices.map(([lat, lon]) => [lat + m(3), lon]);

        const result = dedupeRiddenRoads([ride], roads);
        const coveredLength = result.reduce((sum, seg) => {
            let len = 0;
            for (let i = 1; i < seg.length; i++) len += Math.hypot(seg[i][0] - seg[i - 1][0], seg[i][1] - seg[i - 1][1]) * M_PER_DEG_LAT;
            return sum + len;
        }, 0);

        // Full road is ~300m -- should render as (essentially) one continuous run, not
        // a handful of short fragments totaling far less.
        expect(coveredLength).toBeGreaterThan(280);
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

describe('dedupeRiddenRoads grid cells', () => {
    it('matches a street running just south of a grid cell line to GPS just north of it', () => {
        // Real case: West 27th Ave (Spokane) sits at 47.62998, ~2m south of the
        // 47.630 cell line; a ride along it, 2-6m north, matched nothing.
        const street: [number, number][] = [[47.62998, -117.4249], [47.62998, -117.4236], [47.62998, -117.4222]];
        const ride: [number, number][] = [[47.63002, -117.4222], [47.63004, -117.4229], [47.63001, -117.4236], [47.63003, -117.4243], [47.63002, -117.4249]];
        expect(dedupeRiddenRoads([ride], [street])).toEqual([street]);
    });
});

describe('fillUnbranchedGaps', () => {
    // Points in meters east (x) / north (y) of (0, 0); at the equator a degree of
    // longitude is the same length as a degree of latitude.
    const p = (x: number, y = 0): [number, number] => [metersToLatDeg(y), metersToLatDeg(x)];
    const fill = (roads: [number, number][][], ridden: boolean[][], bounds?: { south: number; west: number; north: number; east: number }) => {
        const edges = ridden.map(r => [...r]);
        fillUnbranchedGaps(roads, edges, bounds);
        return edges;
    };

    it('fills a mid-street gap with no side streets, even across separate OSM ways', () => {
        const roads = [[p(0), p(100)], [p(100), p(175), p(250)], [p(250), p(350)]];
        expect(fill(roads, [[true], [false, false], [true]])[1]).toEqual([true, true]);
    });

    it('does not fill a gap a side street branches off of', () => {
        const roads = [[p(0), p(100)], [p(100), p(175), p(250)], [p(250), p(350)], [p(175), p(175, 100)]];
        expect(fill(roads, [[true], [false, false], [true], [false]])[1]).toEqual([false, false]);
    });

    it('fills from a ridden stretch up to a junction a ridden cross street passes through', () => {
        // Main street ridden 0-100m, unridden 100-250m to a junction at 250m where a
        // north-south cross street (ridden north of it) meets it.
        const roads = [[p(0), p(100)], [p(100), p(250)], [p(250, -100), p(250), p(250, 100)]];
        expect(fill(roads, [[true], [false], [false, true]])[1]).toEqual([true]);
    });

    it('does not fill a gap ending at a junction the rider never reached', () => {
        const roads = [[p(0), p(100)], [p(100), p(250)], [p(250, -100), p(250), p(250, 100)]];
        expect(fill(roads, [[true], [false], [false, false]])[1]).toEqual([false]);
    });

    it('does not fill a grid block just because the ridden streets at both of its corners cross it', () => {
        // Two ridden north-south streets 200m apart; the east-west block between them
        // was never ridden.
        const roads = [[p(0, -100), p(0), p(0, 100)], [p(200, -100), p(200), p(200, 100)], [p(0), p(200)]];
        expect(fill(roads, [[true, true], [true, true], [false]])[2]).toEqual([false]);
    });

    it('does not fill a gap longer than the cap', () => {
        const roads = [[p(0), p(100)], [p(100), p(600)], [p(600), p(700)]];
        expect(fill(roads, [[true], [false], [true]])[1]).toEqual([false]);
    });

    it('does not fill a loop hanging off a single junction', () => {
        // Ridden street ending at a junction that a 300m unridden loop starts and ends at.
        const roads = [[p(0), p(100)], [p(100), p(150, 50), p(200), p(150, -50), p(100)]];
        expect(fill(roads, [[true], [false, false, false, false]])[1]).toEqual([false, false, false, false]);
    });

    it('does not trust a gap that leaves the area the roads were fetched for', () => {
        const roads = [[p(0), p(100)], [p(100), p(175), p(250)], [p(250), p(350)]];
        const bounds = { south: metersToLatDeg(-50), north: metersToLatDeg(50), west: metersToLatDeg(-10), east: metersToLatDeg(200) };
        expect(fill(roads, [[true], [false, false], [true]], bounds)[1]).toEqual([false, false]);
    });

    it('is applied by dedupeRiddenRoads to sparse GPS that only touches both ends of a street', () => {
        const street: [number, number][] = [p(0), p(100), p(200), p(300)];
        const result = dedupeRiddenRoads([[p(0), p(60)], [p(240), p(300)]], [street]);
        expect(result).toEqual([street]);
    });
});
