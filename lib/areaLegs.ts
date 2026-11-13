// Draw order for mixed point/area routes (#52). Each area remembers how many
// waypoints existed when it was drawn (its anchor): an area with anchor `a`
// sits between points[a - 1] and points[a]. Areas sharing an anchor were drawn
// back to back and are swept together. Shared by the browser and the server.

type LatLon = { lat: number; lon: number };
type Box = { north: number; south: number; east: number; west: number };
type Polygon = [number, number][]; // [lat, lon]
type Path = [number, number][]; // [lon, lat]

export interface AreaAnchors {
    boxes: number[];
    polygons: number[];
}

export const NO_ANCHORS: AreaAnchors = { boxes: [], polygons: [] };

export function distinctAnchors(anchors: AreaAnchors): number[] {
    return [...new Set([...anchors.boxes, ...anchors.polygons])].sort((a, b) => a - b);
}

export function firstAnchor(anchors: AreaAnchors): number | null {
    return distinctAnchors(anchors)[0] ?? null;
}

export function lastAnchor(anchors: AreaAnchors): number | null {
    const all = distinctAnchors(anchors);
    return all.length > 0 ? all[all.length - 1] : null;
}

// Segment i joins points[i] to points[i + 1]; it is left empty when an area lies between them.
export function segmentCrossesArea(anchors: AreaAnchors, segmentIdx: number): boolean {
    return distinctAnchors(anchors).includes(segmentIdx + 1);
}

const mapAnchors = (anchors: AreaAnchors, f: (a: number) => number): AreaAnchors =>
    ({ boxes: anchors.boxes.map(f), polygons: anchors.polygons.map(f) });

// A waypoint was inserted at `insertedIdx`: areas after it move along with the points after it.
export function shiftAnchorsForInsert(anchors: AreaAnchors, insertedIdx: number): AreaAnchors {
    return mapAnchors(anchors, a => (a >= insertedIdx ? a + 1 : a));
}

// The waypoint at `deletedIdx` was removed.
export function shiftAnchorsForDelete(anchors: AreaAnchors, deletedIdx: number): AreaAnchors {
    return mapAnchors(anchors, a => (a > deletedIdx ? a - 1 : a));
}

export interface AreaLeg {
    approachStart?: LatLon;
    approachRoute: Path; // walked after approachStart; its last coordinate is where the sweep is entered from
    boxes: Box[];
    polygons: Polygon[];
    endPoint?: LatLon; // where the route goes after the sweep
    exitRoute: Path; // walked after the sweep; starts at the first point after it
}

// The road path of each segment from points[from] to points[to], falling back
// to the two waypoints themselves where a segment was never routed.
function walk(points: LatLon[], segments: Path[], from: number, to: number): Path {
    const path: Path = [];
    for (let i = from; i < to; i++) {
        const segment = segments[i];
        if (segment && segment.length > 0) path.push(...segment);
        else path.push([points[i].lon, points[i].lat], [points[i + 1].lon, points[i + 1].lat]);
    }
    return path;
}

// One leg per group of areas, in draw order. `home` starts a route whose first
// area was drawn before any waypoint.
export function buildAreaLegs(
    points: LatLon[],
    segments: Path[],
    boxes: Box[],
    polygons: Polygon[],
    anchors: AreaAnchors,
    home?: LatLon | null,
): AreaLeg[] {
    const clamp = (a: number) => Math.max(0, Math.min(points.length, a));
    const groups = distinctAnchors(mapAnchors(anchors, clamp));
    return groups.map((anchor, g) => {
        const previous = g === 0 ? 0 : groups[g - 1];
        const isLast = g === groups.length - 1;
        const approachStart = anchor > previous ? points[previous] : (g === 0 ? home ?? undefined : undefined);
        const leg: AreaLeg = {
            approachStart,
            approachRoute: anchor > previous ? walk(points, segments, previous, anchor - 1) : [],
            boxes: boxes.filter((_, i) => clamp(anchors.boxes[i]) === anchor),
            polygons: polygons.filter((_, i) => clamp(anchors.polygons[i]) === anchor),
            exitRoute: [],
        };
        if (!isLast) {
            leg.endPoint = points[anchor];
        } else if (points.length > anchor) {
            leg.endPoint = points[points.length - 1];
            leg.exitRoute = walk(points, segments, anchor, points.length - 1);
        }
        return leg;
    });
}
