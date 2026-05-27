export interface Waypoint {
    id: string;
    lat: number;
    lon: number;
    status?: string;
}

/**
 * Returns the indices of route segments that must be re-routed when the
 * waypoint at `movedIdx` is moved.  Segment `i` connects points[i] → points[i+1].
 */
export function getAffectedSegmentIndices(movedIdx: number, pointCount: number): number[] {
    const affected: number[] = [];
    if (movedIdx > 0) affected.push(movedIdx - 1);
    if (movedIdx < pointCount - 1) affected.push(movedIdx);
    return affected;
}

/**
 * Returns a new points array with the waypoint matching `pointId` replaced by
 * `newPoint`, preserving the position of every other waypoint.  Returns null if
 * the point no longer exists (was removed while the async snap was in flight).
 */
export function applyMovedPoint(
    points: Waypoint[],
    pointId: string,
    newPoint: Waypoint
): Waypoint[] | null {
    const idx = points.findIndex(p => p.id === pointId);
    if (idx === -1) return null;
    const updated = [...points];
    updated[idx] = newPoint;
    return updated;
}
