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
