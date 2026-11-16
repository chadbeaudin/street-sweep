export interface EdgeSnap {
    lat: number;
    lon: number;
    u: string;
    v: string;
}

type NodeLookup = (id: string) => { lat: number; lon: number } | undefined;

const otherEnd = (snap: EdgeSnap, id: string) => id === snap.u ? snap.v : id === snap.v ? snap.u : null;

// Builds the [lon, lat] polyline from one mid-edge snapped click to the next.
// When the path's first (or last) hop runs along the snap edge itself, the
// edge's endpoint lies behind the click, so visiting it would ride to the
// intersection and straight back. Those endpoints are skipped.
export function buildStepPathCoords(
    prevSnap: EdgeSnap,
    snap: EdgeSnap,
    startId: string,
    endId: string,
    path: { id: string; idNext: string }[],
    getNode: NodeLookup,
): [number, number][] {
    const coords: [number, number][] = [[prevSnap.lon, prevSnap.lat]];
    const push = (lon: number, lat: number) => {
        const last = coords[coords.length - 1];
        if (last[0] !== lon || last[1] !== lat) coords.push([lon, lat]);
    };

    const skipStartOvershoot = path.length > 0 && path[0].id === startId && path[0].idNext === otherEnd(prevSnap, startId);
    if (!skipStartOvershoot) {
        const startNode = getNode(startId);
        if (startNode) push(startNode.lon, startNode.lat);
    }

    const otherSnapEnd = otherEnd(snap, endId);
    for (let i = 0; i < path.length; i++) {
        const segment = path[i];
        const skipEndOvershoot = i === path.length - 1 && segment.idNext === endId && segment.id === otherSnapEnd;
        if (skipEndOvershoot) break;
        const n = getNode(segment.idNext);
        if (n) push(n.lon, n.lat);
    }

    push(snap.lon, snap.lat);
    return coords;
}

type HasLink = (from: string, to: string) => boolean;

// From a mid-edge click, the edge endpoints a rider may legally ride toward (exits)
// and legally arrive from (entries). Both ends for a two-way street, one for a one-way.
export function legalSnapEnds(snap: EdgeSnap, hasLink: HasLink): { exits: string[]; entries: string[] } {
    const exits: string[] = [], entries: string[] = [];
    if (hasLink(snap.u, snap.v)) { exits.push(snap.v); entries.push(snap.u); }
    if (hasLink(snap.v, snap.u)) { exits.push(snap.u); entries.push(snap.v); }
    return { exits, entries };
}

// Two clicks on the same one-way edge, in its legal direction, are joined directly;
// routing via the edge's endpoints would otherwise send the rider around the block.
export function sameOnewayEdgePath(prevSnap: EdgeSnap, snap: EdgeSnap, getNode: NodeLookup, hasLink: HasLink): [number, number][] | null {
    const sameEdge = (prevSnap.u === snap.u && prevSnap.v === snap.v) || (prevSnap.u === snap.v && prevSnap.v === snap.u);
    if (!sameEdge) return null;
    const forward = hasLink(snap.u, snap.v), backward = hasLink(snap.v, snap.u);
    if (forward === backward) return null;
    const u = getNode(snap.u);
    if (!u) return null;
    const fromU = (p: { lat: number; lon: number }) => (p.lat - u.lat) ** 2 + (p.lon - u.lon) ** 2;
    const headingToV = fromU(snap) > fromU(prevSnap);
    if (headingToV !== forward) return null;
    return [[prevSnap.lon, prevSnap.lat], [snap.lon, snap.lat]];
}

type LatLon = { lat: number; lon: number };
type Box = { south: number; west: number; north: number; east: number };

const STEP_BUFFER_DEG = 0.01; // beyond the points, for edge connectivity
const STEP_GRID_DEG = 0.01;   // snapped so nearby requests share a cached graph
// Overpass refuses boxes over 0.5° a side (lib/overpass.ts), leaving the router with no streets.
const MAX_STEP_SPAN_DEG = 0.45;
// Around the points when the viewport is too big to fetch: enough for nearby crossings.
const STEP_FALLBACK_PAD_DEG = 0.02;

// The area a step fetches streets for. Normally the points plus the whole viewport, so
// highway crossings on screen are in the graph. Zoomed out past what Overpass will return
// (as after a suggested route fits the map to it), moving or adding a point found no streets
// and silently failed, so it falls back to the area around the points.
export function stepFetchBbox(point: LatLon, lastPoint: LatLon | null | undefined, viewport: Box): Box {
    const points = lastPoint ? [point, lastPoint] : [point];
    const around = {
        south: Math.min(...points.map(p => p.lat)), north: Math.max(...points.map(p => p.lat)),
        west: Math.min(...points.map(p => p.lon)), east: Math.max(...points.map(p => p.lon)),
    };
    const withViewport = {
        south: Math.min(around.south, viewport.south) - STEP_BUFFER_DEG, north: Math.max(around.north, viewport.north) + STEP_BUFFER_DEG,
        west: Math.min(around.west, viewport.west) - STEP_BUFFER_DEG, east: Math.max(around.east, viewport.east) + STEP_BUFFER_DEG,
    };
    const fitsFetch = withViewport.north - withViewport.south <= MAX_STEP_SPAN_DEG && withViewport.east - withViewport.west <= MAX_STEP_SPAN_DEG;
    const box = fitsFetch ? withViewport : {
        south: around.south - STEP_FALLBACK_PAD_DEG, north: around.north + STEP_FALLBACK_PAD_DEG,
        west: around.west - STEP_FALLBACK_PAD_DEG, east: around.east + STEP_FALLBACK_PAD_DEG,
    };
    const snap = (n: number, down: boolean) => Number(((down ? Math.floor(n / STEP_GRID_DEG) : Math.ceil(n / STEP_GRID_DEG)) * STEP_GRID_DEG).toFixed(4));
    return { south: snap(box.south, true), west: snap(box.west, true), north: snap(box.north, false), east: snap(box.east, false) };
}
