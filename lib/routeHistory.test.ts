import { RouteSnapshot, pushSnapshot, undo, redo, isFirstPointAfterArea, shouldAddComputedEndpoint, dropStaleComputedEndpoint } from './routeHistory';

const snap = (over: Partial<RouteSnapshot> = {}): RouteSnapshot => ({
    points: [],
    route: [],
    selectionBoxes: [],
    selectionPolygons: [],
    preAreaPointCount: null,
    ...over,
});

const box = { north: 39.03, south: 39.02, east: -104.7, west: -104.71 };

describe('routeHistory', () => {
    it('pushSnapshot appends and advances the index', () => {
        let { history, index } = pushSnapshot([], -1, snap({ points: [{ lat: 1, lon: 1, id: 'a' }] }));
        expect(history).toHaveLength(1);
        expect(index).toBe(0);
        ({ history, index } = pushSnapshot(history, index, snap()));
        expect(history).toHaveLength(2);
        expect(index).toBe(1);
    });

    it('pushSnapshot discards the redo branch when not at the tip', () => {
        const base = [snap(), snap(), snap()];
        const { history, index } = pushSnapshot(base, 0, snap({ preAreaPointCount: 9 }));
        expect(history).toHaveLength(2); // kept index 0, dropped 1 & 2, added new
        expect(index).toBe(1);
        expect(history[1].preAreaPointCount).toBe(9);
    });

    // #25: undo/redo must restore selection boxes and preAreaPointCount, not just points.
    it('undo after adding an area restores the pre-area state (empty boxes)', () => {
        // point-only snapshot, then an area snapshot with a box + preAreaPointCount
        let { history, index } = pushSnapshot([], -1, snap({ points: [{ lat: 1, lon: 1, id: 'a' }] }));
        ({ history, index } = pushSnapshot(history, index, snap({
            points: [{ lat: 1, lon: 1, id: 'a' }],
            selectionBoxes: [box],
            preAreaPointCount: 1,
        })));

        const back = undo(history, index);
        expect(back.index).toBe(0);
        expect(back.snapshot).not.toBeNull();
        expect(back.snapshot!.selectionBoxes).toEqual([]);
        expect(back.snapshot!.preAreaPointCount).toBeNull();
    });

    it('redo returns the area snapshot with its box and count', () => {
        let { history, index } = pushSnapshot([], -1, snap());
        ({ history, index } = pushSnapshot(history, index, snap({ selectionBoxes: [box], preAreaPointCount: 2 })));
        const back = undo(history, index);          // now at index 0
        const fwd = redo(history, back.index);       // forward to the area snapshot
        expect(fwd.index).toBe(1);
        expect(fwd.snapshot!.selectionBoxes).toEqual([box]);
        expect(fwd.snapshot!.preAreaPointCount).toBe(2);
    });

    // A lasso (selectionPolygons) must be undoable exactly like a box: drawing
    // one and then undoing should remove it (and the coverage route generated
    // for it, which regenerates automatically once selectionPolygons reverts).
    const lasso: [number, number][] = [[39.02, -104.71], [39.03, -104.71], [39.03, -104.7]];

    it('undo after drawing a lasso restores the pre-lasso state (empty polygons)', () => {
        let { history, index } = pushSnapshot([], -1, snap({ points: [{ lat: 1, lon: 1, id: 'a' }] }));
        ({ history, index } = pushSnapshot(history, index, snap({
            points: [{ lat: 1, lon: 1, id: 'a' }],
            selectionPolygons: [lasso],
            preAreaPointCount: 1,
        })));

        const back = undo(history, index);
        expect(back.index).toBe(0);
        expect(back.snapshot).not.toBeNull();
        expect(back.snapshot!.selectionPolygons).toEqual([]);
        expect(back.snapshot!.preAreaPointCount).toBeNull();
    });

    it('redo returns the lasso snapshot with its polygon and count', () => {
        let { history, index } = pushSnapshot([], -1, snap());
        ({ history, index } = pushSnapshot(history, index, snap({ selectionPolygons: [lasso], preAreaPointCount: 2 })));
        const back = undo(history, index);
        const fwd = redo(history, back.index);
        expect(fwd.index).toBe(1);
        expect(fwd.snapshot!.selectionPolygons).toEqual([lasso]);
        expect(fwd.snapshot!.preAreaPointCount).toBe(2);
    });

    it('undo at the first entry signals a clear (null snapshot)', () => {
        const { history } = pushSnapshot([], -1, snap());
        const back = undo(history, 0);
        expect(back.snapshot).toBeNull();
        expect(back.index).toBe(0);
    });

    it('redo at the tip is a no-op', () => {
        const { history, index } = pushSnapshot([], -1, snap());
        expect(redo(history, index).snapshot).toBeNull();
    });
});

describe('isFirstPointAfterArea', () => {
    it('is false when no area has been drawn', () => {
        expect(isFirstPointAfterArea(null, 0)).toBe(false);
        expect(isFirstPointAfterArea(null, 3)).toBe(false);
    });

    it('is true exactly for the first point clicked right after the area', () => {
        // Area was drawn after 2 points (indices 0,1); the 3rd click is index 2.
        expect(isFirstPointAfterArea(2, 2)).toBe(true);
    });

    it('is false for points before or after that first post-area point', () => {
        expect(isFirstPointAfterArea(2, 1)).toBe(false); // still pre-area
        expect(isFirstPointAfterArea(2, 3)).toBe(false); // second post-area point — steps normally from the first
    });
});

describe('shouldAddComputedEndpoint', () => {
    it('is false when there is no area', () => {
        expect(shouldAddComputedEndpoint(2, 2, false)).toBe(false);
    });

    it('is false when no area has been drawn yet (preAreaPointCount null)', () => {
        expect(shouldAddComputedEndpoint(null, 2, true)).toBe(false);
    });

    it('is true right after an area is drawn with no real point placed past it yet', () => {
        // 2 points before the area (indices 0,1); no 3rd point clicked yet.
        expect(shouldAddComputedEndpoint(2, 2, true)).toBe(true);
    });

    it('is false once a real post-area point already exists — add the marker only once', () => {
        expect(shouldAddComputedEndpoint(2, 3, true)).toBe(false);
    });
});

// Real user report: after generating a route over one lasso, the app
// materializes the sweep's end as a waypoint. Drawing a SECOND lasso then made
// that stale endpoint the route's destination, so the route swept the new area
// and backtracked several miles to where the previous sweep had ended.
describe('dropStaleComputedEndpoint', () => {
    type TestPoint = { id: string; lat: number; lon: number; computed?: boolean };
    const clicked = (id: string): TestPoint => ({ id, lat: 1, lon: 1 });
    const computed = (id: string): TestPoint => ({ id, lat: 2, lon: 2, computed: true });

    it('drops a trailing auto-computed endpoint', () => {
        const points = [clicked('a'), clicked('b'), computed('c')];
        expect(dropStaleComputedEndpoint(points).map(p => p.id)).toEqual(['a', 'b']);
    });

    it('keeps a trailing endpoint the user actually clicked', () => {
        const points = [clicked('a'), clicked('b')];
        expect(dropStaleComputedEndpoint(points)).toBe(points);
    });

    it('keeps a computed point that is not the last one — the user clicked past it', () => {
        const points = [clicked('a'), computed('b'), clicked('c')];
        expect(dropStaleComputedEndpoint(points).map(p => p.id)).toEqual(['a', 'b', 'c']);
    });

    it('returns the same array reference when nothing is dropped, so callers can skip a re-render', () => {
        const points = [clicked('a')];
        expect(dropStaleComputedEndpoint(points)).toBe(points);
    });

    it('handles an empty list', () => {
        expect(dropStaleComputedEndpoint([])).toEqual([]);
    });

    // After the drop, point count falls back to preAreaPointCount, which is
    // what makes the server treat the new area as the route's end (no
    // post-area waypoint => no forced exit bridge back to the old endpoint).
    it('restores the point count to preAreaPointCount so no exit bridge is requested', () => {
        const preAreaPointCount = 2;
        const points = [clicked('a'), clicked('b'), computed('c')];
        const trimmed = dropStaleComputedEndpoint(points);
        expect(trimmed).toHaveLength(preAreaPointCount);
        expect(shouldAddComputedEndpoint(preAreaPointCount, trimmed.length, true)).toBe(true);
    });
});
