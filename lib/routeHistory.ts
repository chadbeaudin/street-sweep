// Pure undo/redo history stack for the route editor. A snapshot captures the
// full editable state — including selection boxes and the pre-area point count —
// so undo/redo after an area selection restores those too (#25).

export interface RouteSnapshot {
    points: { lat: number; lon: number; id: string; status?: 'pending' | 'snapped' }[];
    route: [number, number][][];
    selectionBoxes: { north: number; south: number; east: number; west: number }[];
    preAreaPointCount: number | null;
}

// Push a new snapshot, discarding any redo branch beyond the current index.
export function pushSnapshot(history: RouteSnapshot[], index: number, snap: RouteSnapshot): { history: RouteSnapshot[]; index: number } {
    const next = [...history.slice(0, index + 1), snap];
    return { history: next, index: next.length - 1 };
}

// Step back one snapshot. Returns snapshot=null at the first entry (the caller
// clears the route in that case).
export function undo(history: RouteSnapshot[], index: number): { snapshot: RouteSnapshot | null; index: number } {
    if (index > 0) return { snapshot: history[index - 1], index: index - 1 };
    return { snapshot: null, index };
}

// Step forward one snapshot, if there is a redo branch.
export function redo(history: RouteSnapshot[], index: number): { snapshot: RouteSnapshot | null; index: number } {
    if (index < history.length - 1) return { snapshot: history[index + 1], index: index + 1 };
    return { snapshot: null, index };
}

// When a point is clicked right after an area/lasso is drawn, /api/step must
// NOT be told to path from the point before the area — that ignores the area
// entirely and produces a real, but wrong, direct road path bypassing it (a
// visible straight-ish line parallel to the actual route). The server's
// mixed-mode bridging already connects the area's own end to this point, so
// it should be treated like a fresh route start (no path segment requested).
export function isFirstPointAfterArea(preAreaPointCount: number | null, pointIndex: number): boolean {
    return preAreaPointCount !== null && pointIndex === preAreaPointCount;
}
