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
