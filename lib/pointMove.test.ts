import { getAffectedSegmentIndices, applyMovedPoint, Waypoint } from './pointMove';

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
