// Pure undo/redo history stack for the route editor. A snapshot captures the
// full editable state — including selection boxes and where each was drawn —
// so undo/redo after an area selection restores those too (#25).

import type { AreaAnchors } from './areaLegs';

export interface RouteSnapshot {
    points: { lat: number; lon: number; id: string; status?: 'pending' | 'snapped'; computed?: boolean }[];
    route: [number, number][][];
    selectionBoxes: { north: number; south: number; east: number; west: number }[];
    selectionPolygons: [number, number][][];
    areaAnchors: AreaAnchors;
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

// After generating a mixed-mode area/lasso sweep with no real waypoint placed
// after it yet, the coverage trail's end is a server-computed point the user
// has never clicked and can't see or drag. It should be materialized as a
// real, editable waypoint — but only once: as soon as a real post-area point
// exists after the last-drawn area (currentPointCount > lastAreaAnchor), don't add another.
export function shouldAddComputedEndpoint(lastAreaAnchor: number | null, currentPointCount: number, hasArea: boolean): boolean {
    return hasArea && lastAreaAnchor !== null && currentPointCount === lastAreaAnchor;
}

/**
 * Drop a trailing auto-computed endpoint when a new area is drawn.
 *
 * That endpoint only ever recorded where the previous sweep happened to finish
 * — the user never chose it. Leaving it in place makes it the route's
 * destination, so drawing a second lasso produces a sweep of the new area
 * followed by a long backtrack to the old endpoint, instead of simply ending
 * in the newly drawn area. A waypoint the user actually clicked is a real
 * destination and is always kept.
 */
export function dropStaleComputedEndpoint<T extends { computed?: boolean }>(points: T[]): T[] {
    if (points.length > 0 && points[points.length - 1].computed) {
        return points.slice(0, -1);
    }
    return points;
}
