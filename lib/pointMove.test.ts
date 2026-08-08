import { getAffectedSegmentIndices, applyMovedPoint, insertWaypointAtSegment, removeWaypoint, Waypoint } from './pointMove';

function makePoints(count: number): Waypoint[] {
    return Array.from({ length: count }, (_, i) => ({
        id: `pt-${i}`,
        lat: 39.0 + i * 0.001,
        lon: -104.7 + i * 0.001,
        status: 'snapped',
    }));
}

// ── getAffectedSegmentIndices ─────────────────────────────────────────────────

describe('getAffectedSegmentIndices', () => {
    describe('8 points, moving point #4 (idx 3)', () => {
        const affected = getAffectedSegmentIndices(3, 8);

        it('returns exactly 2 segments', () => {
            expect(affected).toHaveLength(2);
        });

        it('includes the segment before the moved point (seg 2: pt2→pt3)', () => {
            expect(affected).toContain(2);
        });

        it('includes the segment after the moved point (seg 3: pt3→pt4)', () => {
            expect(affected).toContain(3);
        });

        it('does not touch any other segment', () => {
            const untouched = [0, 1, 4, 5, 6];
            for (const i of untouched) {
                expect(affected).not.toContain(i);
            }
        });
    });

    describe('moving the first point (idx 0)', () => {
        it('only recalculates the segment forward (seg 0)', () => {
            expect(getAffectedSegmentIndices(0, 8)).toEqual([0]);
        });
    });

    describe('moving the last point (idx 7 of 8)', () => {
        it('only recalculates the segment backward (seg 6)', () => {
            expect(getAffectedSegmentIndices(7, 8)).toEqual([6]);
        });
    });

    describe('moving the only point (1 point total)', () => {
        it('returns no affected segments', () => {
            expect(getAffectedSegmentIndices(0, 1)).toEqual([]);
        });
    });

    describe('moving middle points of a 2-point route', () => {
        it('moving first of 2 recalculates seg 0 only', () => {
            expect(getAffectedSegmentIndices(0, 2)).toEqual([0]);
        });
        it('moving last of 2 recalculates seg 0 only', () => {
            expect(getAffectedSegmentIndices(1, 2)).toEqual([0]);
        });
    });
});

// ── applyMovedPoint ───────────────────────────────────────────────────────────

describe('applyMovedPoint', () => {
    describe('moving point #4 (idx 3) in an 8-point array', () => {
        const original = makePoints(8);
        const movedId = original[3].id;
        const newPos: Waypoint = { id: movedId, lat: 39.99, lon: -104.99, status: 'snapped' };
        const result = applyMovedPoint(original, movedId, newPos)!;

        it('returns an array of the same length', () => {
            expect(result).toHaveLength(8);
        });

        it('places the updated point at index 3 (point #4)', () => {
            expect(result[3]).toEqual(newPos);
        });

        it('preserves the position of every other point', () => {
            for (let i = 0; i < 8; i++) {
                if (i === 3) continue;
                expect(result[i]).toEqual(original[i]);
            }
        });

        it('preserves the moved point ID', () => {
            expect(result[3].id).toBe(movedId);
        });

        it('does not mutate the original array', () => {
            expect(original[3].lat).not.toBe(99.99);
        });
    });

    describe('point was deleted while snap was in flight', () => {
        it('returns null when pointId is not found', () => {
            const points = makePoints(4);
            expect(applyMovedPoint(points, 'gone-id', points[0])).toBeNull();
        });
    });

    describe('moving the first point', () => {
        it('updates index 0 only', () => {
            const pts = makePoints(3);
            const newPos: Waypoint = { id: pts[0].id, lat: 1, lon: 1 };
            const result = applyMovedPoint(pts, pts[0].id, newPos)!;
            expect(result[0]).toEqual(newPos);
            expect(result[1]).toEqual(pts[1]);
            expect(result[2]).toEqual(pts[2]);
        });
    });

    describe('moving the last point', () => {
        it('updates the last index only', () => {
            const pts = makePoints(3);
            const newPos: Waypoint = { id: pts[2].id, lat: 2, lon: 2 };
            const result = applyMovedPoint(pts, pts[2].id, newPos)!;
            expect(result[0]).toEqual(pts[0]);
            expect(result[1]).toEqual(pts[1]);
            expect(result[2]).toEqual(newPos);
        });
    });
});

// ── insertWaypointAtSegment ───────────────────────────────────────────────────

function makeRoute(segmentCount: number): [number, number][][] {
    return Array.from({ length: segmentCount }, (_, i) => [
        [i * 0.001, i * 0.001] as [number, number],
        [(i + 1) * 0.001, (i + 1) * 0.001] as [number, number],
    ]);
}

const NEW_PT: Waypoint = { id: 'new', lat: 39.5, lon: -104.5, status: 'pending' };

describe('insertWaypointAtSegment', () => {
    describe('2-point route (1 segment) — inserting at segment 0', () => {
        const pts = makePoints(2);
        const route = makeRoute(1);
        const { newPoints, newRoute } = insertWaypointAtSegment(pts, route, 0, NEW_PT);

        it('produces 3 waypoints', () => expect(newPoints).toHaveLength(3));
        it('places new point at index 1', () => expect(newPoints[1]).toEqual(NEW_PT));
        it('preserves original start at index 0', () => expect(newPoints[0]).toEqual(pts[0]));
        it('preserves original end at index 2', () => expect(newPoints[2]).toEqual(pts[1]));
        it('produces 2 route segments', () => expect(newRoute).toHaveLength(2));
        it('both new segments are empty placeholders', () => {
            expect(newRoute[0]).toEqual([]);
            expect(newRoute[1]).toEqual([]);
        });
    });

    describe('4-point route — inserting at first segment (segmentIdx=0)', () => {
        const pts = makePoints(4);
        const route = makeRoute(3);
        const { newPoints, newRoute } = insertWaypointAtSegment(pts, route, 0, NEW_PT);

        it('produces 5 waypoints', () => expect(newPoints).toHaveLength(5));
        it('places new point at index 1', () => expect(newPoints[1]).toEqual(NEW_PT));
        it('produces 4 route segments', () => expect(newRoute).toHaveLength(4));
        it('replaces segment 0 with two empty placeholders', () => {
            expect(newRoute[0]).toEqual([]);
            expect(newRoute[1]).toEqual([]);
        });
        it('preserves segments 1 and 2 at their new indices', () => {
            expect(newRoute[2]).toEqual(route[1]);
            expect(newRoute[3]).toEqual(route[2]);
        });
    });

    describe('4-point route — inserting at last segment (segmentIdx=2)', () => {
        const pts = makePoints(4);
        const route = makeRoute(3);
        const { newPoints, newRoute } = insertWaypointAtSegment(pts, route, 2, NEW_PT);

        it('places new point at index 3 (second-to-last)', () => expect(newPoints[3]).toEqual(NEW_PT));
        it('original endpoint is still last', () => expect(newPoints[4]).toEqual(pts[3]));
        it('preserves segments 0 and 1 unchanged', () => {
            expect(newRoute[0]).toEqual(route[0]);
            expect(newRoute[1]).toEqual(route[1]);
        });
        it('replaces segment 2 with two empty placeholders', () => {
            expect(newRoute[2]).toEqual([]);
            expect(newRoute[3]).toEqual([]);
        });
    });

    describe('4-point route — inserting at middle segment (segmentIdx=1)', () => {
        const pts = makePoints(4);
        const route = makeRoute(3);
        const { newPoints, newRoute } = insertWaypointAtSegment(pts, route, 1, NEW_PT);

        it('produces 5 waypoints', () => expect(newPoints).toHaveLength(5));
        it('places new point at index 2', () => expect(newPoints[2]).toEqual(NEW_PT));
        it('produces 4 route segments', () => expect(newRoute).toHaveLength(4));
        it('preserves segment 0 at index 0', () => expect(newRoute[0]).toEqual(route[0]));
        it('replaces segment 1 with two empty placeholders at indices 1 and 2', () => {
            expect(newRoute[1]).toEqual([]);
            expect(newRoute[2]).toEqual([]);
        });
        it('preserves segment 2 at new index 3', () => expect(newRoute[3]).toEqual(route[2]));
    });

    describe('segment count invariant', () => {
        it('always produces one more segment than the original', () => {
            for (let n = 1; n <= 5; n++) {
                const { newRoute } = insertWaypointAtSegment(makePoints(n + 1), makeRoute(n), 0, NEW_PT);
                expect(newRoute).toHaveLength(n + 1);
            }
        });

        it('always produces one more waypoint than the original', () => {
            for (let n = 2; n <= 6; n++) {
                const { newPoints } = insertWaypointAtSegment(makePoints(n), makeRoute(n - 1), 0, NEW_PT);
                expect(newPoints).toHaveLength(n + 1);
            }
        });
    });

    describe('immutability', () => {
        it('does not mutate the original points array', () => {
            const pts = makePoints(3);
            insertWaypointAtSegment(pts, makeRoute(2), 0, NEW_PT);
            expect(pts).toHaveLength(3);
        });

        it('does not mutate the original route array', () => {
            const route = makeRoute(2);
            insertWaypointAtSegment(makePoints(3), route, 0, NEW_PT);
            expect(route).toHaveLength(2);
        });

        it('does not mutate inner segment arrays', () => {
            const route = makeRoute(3);
            const seg1Before = route[1].length;
            insertWaypointAtSegment(makePoints(4), route, 1, NEW_PT);
            expect(route[1]).toHaveLength(seg1Before);
        });
    });
});

// ── removeWaypoint ────────────────────────────────────────────────────────────

describe('removeWaypoint', () => {
    describe('removing an interior point (idx 1 of 4)', () => {
        const pts = makePoints(4);
        const route = makeRoute(3);
        const { newPoints, newRoute, segmentToRoute } = removeWaypoint(pts, route, 1);

        it('produces 3 waypoints', () => expect(newPoints).toHaveLength(3));
        it('removes the point at idx 1', () => {
            expect(newPoints).toEqual([pts[0], pts[2], pts[3]]);
        });
        it('produces 2 route segments', () => expect(newRoute).toHaveLength(2));
        it('replaces both adjacent segments with one empty placeholder', () => {
            expect(newRoute[0]).toEqual([]);
        });
        it('preserves the untouched trailing segment', () => {
            expect(newRoute[1]).toEqual(route[2]);
        });
        it('flags the placeholder index for re-routing', () => {
            expect(segmentToRoute).toBe(0);
        });
    });

    describe('removing the first point (idx 0 of 4)', () => {
        const pts = makePoints(4);
        const route = makeRoute(3);
        const { newPoints, newRoute, segmentToRoute } = removeWaypoint(pts, route, 0);

        it('produces 3 waypoints starting at the old idx 1', () => {
            expect(newPoints).toEqual([pts[1], pts[2], pts[3]]);
        });
        it('drops only the first segment', () => {
            expect(newRoute).toEqual([route[1], route[2]]);
        });
        it('needs no re-routing', () => expect(segmentToRoute).toBeNull());
    });

    describe('removing the last point (idx 3 of 4)', () => {
        const pts = makePoints(4);
        const route = makeRoute(3);
        const { newPoints, newRoute, segmentToRoute } = removeWaypoint(pts, route, 3);

        it('produces 3 waypoints ending at the old idx 2', () => {
            expect(newPoints).toEqual([pts[0], pts[1], pts[2]]);
        });
        it('drops only the last segment', () => {
            expect(newRoute).toEqual([route[0], route[1]]);
        });
        it('needs no re-routing', () => expect(segmentToRoute).toBeNull());
    });

    describe('removing the only point (1 point total)', () => {
        it('produces an empty points and route array', () => {
            const pts = makePoints(1);
            const { newPoints, newRoute, segmentToRoute } = removeWaypoint(pts, [], 0);
            expect(newPoints).toEqual([]);
            expect(newRoute).toEqual([]);
            expect(segmentToRoute).toBeNull();
        });
    });

    describe('removing one of two points', () => {
        it('removing the first leaves the second with no segments', () => {
            const pts = makePoints(2);
            const route = makeRoute(1);
            const { newPoints, newRoute, segmentToRoute } = removeWaypoint(pts, route, 0);
            expect(newPoints).toEqual([pts[1]]);
            expect(newRoute).toEqual([]);
            expect(segmentToRoute).toBeNull();
        });

        it('removing the last leaves the first with no segments', () => {
            const pts = makePoints(2);
            const route = makeRoute(1);
            const { newPoints, newRoute, segmentToRoute } = removeWaypoint(pts, route, 1);
            expect(newPoints).toEqual([pts[0]]);
            expect(newRoute).toEqual([]);
            expect(segmentToRoute).toBeNull();
        });
    });

    describe('immutability', () => {
        it('does not mutate the original points or route arrays', () => {
            const pts = makePoints(4);
            const route = makeRoute(3);
            removeWaypoint(pts, route, 1);
            expect(pts).toHaveLength(4);
            expect(route).toHaveLength(3);
        });
    });
});
