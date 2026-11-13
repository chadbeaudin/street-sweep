import { buildAreaLegs, distinctAnchors, firstAnchor, lastAnchor, segmentCrossesArea, shiftAnchorsForInsert, shiftAnchorsForDelete, NO_ANCHORS } from './areaLegs';

const pt = (n: number) => ({ lat: n, lon: n * 10 });
const seg = (a: number, b: number): [number, number][] => [[a * 10, a], [(a + b) * 5, (a + b) / 2], [b * 10, b]];
const box = (n: number) => ({ north: n, south: n, east: n, west: n });
const lasso = (n: number): [number, number][] => [[n, n], [n + 1, n], [n, n + 1]];

describe('area anchors (#52)', () => {
    it('lists each drawing position once, in order', () => {
        expect(distinctAnchors({ boxes: [4, 2], polygons: [2] })).toEqual([2, 4]);
        expect(firstAnchor({ boxes: [4, 2], polygons: [2] })).toBe(2);
        expect(lastAnchor({ boxes: [4, 2], polygons: [2] })).toBe(4);
        expect(firstAnchor(NO_ANCHORS)).toBeNull();
        expect(lastAnchor(NO_ANCHORS)).toBeNull();
    });

    it('knows which segment has an area between its two points', () => {
        const anchors = { boxes: [2], polygons: [4] };
        expect(segmentCrossesArea(anchors, 1)).toBe(true);  // points 1 → 2
        expect(segmentCrossesArea(anchors, 3)).toBe(true);  // points 3 → 4
        expect(segmentCrossesArea(anchors, 0)).toBe(false);
        expect(segmentCrossesArea(anchors, 2)).toBe(false);
    });

    it('moves areas along with the points after an inserted waypoint', () => {
        expect(shiftAnchorsForInsert({ boxes: [2], polygons: [4] }, 3)).toEqual({ boxes: [2], polygons: [5] });
        expect(shiftAnchorsForInsert({ boxes: [2], polygons: [4] }, 1)).toEqual({ boxes: [3], polygons: [5] });
    });

    it('keeps an area between the same neighbours when a waypoint is deleted', () => {
        // Points A B | area | C D: deleting A (0) or B (1) pulls the area one earlier...
        expect(shiftAnchorsForDelete({ boxes: [2], polygons: [] }, 0)).toEqual({ boxes: [1], polygons: [] });
        expect(shiftAnchorsForDelete({ boxes: [2], polygons: [] }, 1)).toEqual({ boxes: [1], polygons: [] });
        // ...deleting C (2) or D (3) leaves it where it is.
        expect(shiftAnchorsForDelete({ boxes: [2], polygons: [] }, 2)).toEqual({ boxes: [2], polygons: [] });
        expect(shiftAnchorsForDelete({ boxes: [2], polygons: [] }, 3)).toEqual({ boxes: [2], polygons: [] });
    });
});

describe('buildAreaLegs (#52)', () => {
    // A B | box | C' C | lasso | D' D, with empty segments across each area.
    const points = [0, 1, 2, 3, 4, 5].map(pt);
    const segments = [seg(0, 1), [], seg(2, 3), [], seg(4, 5)];

    it('builds one leg per area in draw order, each ending at the next point', () => {
        const legs = buildAreaLegs(points, segments, [box(1)], [lasso(2)], { boxes: [2], polygons: [4] });
        expect(legs).toHaveLength(2);

        expect(legs[0].approachStart).toEqual(pt(0));
        expect(legs[0].approachRoute).toEqual(seg(0, 1));
        expect(legs[0].boxes).toEqual([box(1)]);
        expect(legs[0].polygons).toEqual([]);
        expect(legs[0].endPoint).toEqual(pt(2));
        expect(legs[0].exitRoute).toEqual([]);

        expect(legs[1].approachStart).toEqual(pt(2));
        expect(legs[1].approachRoute).toEqual(seg(2, 3));
        expect(legs[1].boxes).toEqual([]);
        expect(legs[1].polygons).toEqual([lasso(2)]);
        expect(legs[1].endPoint).toEqual(pt(5));
        expect(legs[1].exitRoute).toEqual(seg(4, 5));
    });

    it('sweeps areas drawn back to back in the same leg', () => {
        const legs = buildAreaLegs(points, segments, [box(1), box(2)], [lasso(3)], { boxes: [2, 4], polygons: [2] });
        expect(legs).toHaveLength(2);
        expect(legs[0].boxes).toEqual([box(1)]);
        expect(legs[0].polygons).toEqual([lasso(3)]);
        expect(legs[1].boxes).toEqual([box(2)]);
    });

    it('leaves the last sweep open-ended when no point follows it', () => {
        const legs = buildAreaLegs(points.slice(0, 4), segments.slice(0, 3), [box(1), box(2)], [], { boxes: [2, 4], polygons: [] });
        expect(legs[1].approachStart).toEqual(pt(2));
        expect(legs[1].endPoint).toBeUndefined();
        expect(legs[1].exitRoute).toEqual([]);
    });

    it('walks straight between waypoints whose segment was never routed', () => {
        const legs = buildAreaLegs(points, [[], [], [], [], []], [box(1)], [lasso(2)], { boxes: [2], polygons: [4] });
        expect(legs[0].approachRoute).toEqual([[0, 0], [10, 1]]);
        expect(legs[1].exitRoute).toEqual([[40, 4], [50, 5]]);
    });

    it('starts from home when the first area was drawn before any waypoint', () => {
        const home = { lat: 9, lon: 9 };
        const legs = buildAreaLegs(points.slice(0, 2), [seg(0, 1)], [box(1), box(2)], [], { boxes: [0, 2], polygons: [] }, home);
        expect(legs[0].approachStart).toEqual(home);
        expect(legs[0].approachRoute).toEqual([]);
        expect(legs[0].endPoint).toEqual(pt(0));
        expect(buildAreaLegs(points.slice(0, 2), [seg(0, 1)], [box(1), box(2)], [], { boxes: [0, 2], polygons: [] })[0].approachStart).toBeUndefined();
    });

    it('treats an anchor past the last point as "after every point"', () => {
        const legs = buildAreaLegs(points.slice(0, 3), segments.slice(0, 2), [box(1), box(2)], [], { boxes: [2, 99], polygons: [] });
        expect(legs).toHaveLength(2);
        expect(legs[1].approachStart).toEqual(pt(2));
        expect(legs[1].endPoint).toBeUndefined();
    });
});
