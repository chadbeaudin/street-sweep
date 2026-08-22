import { RouteSnapshot, pushSnapshot, undo, redo, isFirstPointAfterArea } from './routeHistory';

const snap = (over: Partial<RouteSnapshot> = {}): RouteSnapshot => ({
    points: [],
    route: [],
    selectionBoxes: [],
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
