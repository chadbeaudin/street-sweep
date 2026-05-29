export interface Waypoint {
    id: string;
    lat: number;
    lon: number;
    status?: 'snapped' | 'pending';
}

/**
 * Inserts `newPoint` between the two waypoints that border `segmentIdx`.
 * Segment i connects points[i] → points[i+1], so inserting at segmentIdx places
 * the new waypoint at index segmentIdx+1.  The original segment is replaced by
 * two empty placeholders that the caller must fill by re-routing.
 */
export function insertWaypointAtSegment(
    points: Waypoint[],
    route: [number, number][][],
    segmentIdx: number,
    newPoint: Waypoint
): { newPoints: Waypoint[]; newRoute: [number, number][][] } {
    const newPoints = [
        ...points.slice(0, segmentIdx + 1),
        newPoint,
        ...points.slice(segmentIdx + 1),
    ];
    const newRoute: [number, number][][] = [
        ...route.slice(0, segmentIdx),
        [], // placeholder: points[segmentIdx] → newPoint
        [], // placeholder: newPoint → points[segmentIdx+1]
        ...route.slice(segmentIdx + 1),
    ];
    return { newPoints, newRoute };
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
