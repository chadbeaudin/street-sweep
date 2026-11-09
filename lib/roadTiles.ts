export const ROAD_TILE = 0.01; // ~1.1km cells
export const ROAD_TILE_BUFFER = 0.002;

export interface BBox { south: number; west: number; north: number; east: number }
export interface TileCoord { ty: number; tx: number }

// A real viewport is a handful of km across at most; this is generous headroom for that
// (a few hundred km) while still rejecting anything continent/world-scale, which would
// otherwise blow up the tile grid below into billions of entries and crash with
// "Invalid array length" (e.g. a map briefly at a world-scale placeholder view).
const MAX_BBOX_SPAN_DEG = 2;

// Tiles covering a bbox (plus a small buffer), at the ROAD_TILE grid.
export function tilesForBBox(bbox: BBox): TileCoord[] {
    if (bbox.north - bbox.south > MAX_BBOX_SPAN_DEG || bbox.east - bbox.west > MAX_BBOX_SPAN_DEG) {
        return [];
    }

    const minTy = Math.floor((bbox.south - ROAD_TILE_BUFFER) / ROAD_TILE);
    const maxTy = Math.ceil((bbox.north + ROAD_TILE_BUFFER) / ROAD_TILE);
    const minTx = Math.floor((bbox.west - ROAD_TILE_BUFFER) / ROAD_TILE);
    const maxTx = Math.ceil((bbox.east + ROAD_TILE_BUFFER) / ROAD_TILE);

    const tiles: TileCoord[] = [];
    for (let ty = minTy; ty < maxTy; ty++) {
        for (let tx = minTx; tx < maxTx; tx++) tiles.push({ ty, tx });
    }
    return tiles;
}

// Grows a bbox by `fraction` of its own size on every side. Falls back to the
// original bbox if growing it would exceed MAX_BBOX_SPAN_DEG, since tilesForBBox
// would then return no tiles at all.
export function expandBBox(bbox: BBox, fraction: number): BBox {
    const dLat = (bbox.north - bbox.south) * fraction;
    const dLng = (bbox.east - bbox.west) * fraction;
    const expanded = { south: bbox.south - dLat, north: bbox.north + dLat, west: bbox.west - dLng, east: bbox.east + dLng };
    const tooBig = expanded.north - expanded.south > MAX_BBOX_SPAN_DEG || expanded.east - expanded.west > MAX_BBOX_SPAN_DEG;
    return tooBig ? bbox : expanded;
}

// Ridden-road polylines keyed by server tile, so re-receiving a tile replaces
// it instead of duplicating its roads.
export type RiddenTileRoads = Record<string, [number, number][][]>;

// Server-side ridden-roads cache granularity (~2.2km), shared so the client
// can tell which areas have already been matched.
export const RIDDEN_TILE = 0.02;
export const riddenTileKey = (lat: number, lon: number) => `${Math.floor(lat / RIDDEN_TILE)},${Math.floor(lon / RIDDEN_TILE)}`;

// Splits polylines into the runs that fall in tiles not yet matched, keeping
// the first point inside a matched tile so a run visually meets the matched
// overlay instead of stopping short of it.
export function unmatchedRuns(roads: [number, number][][], matched: Set<string>): [number, number][][] {
    const runs: [number, number][][] = [];
    for (const road of roads) {
        let run: [number, number][] = [];
        for (const pt of road) {
            const isMatched = matched.has(riddenTileKey(pt[0], pt[1]));
            if (!isMatched) {
                run.push(pt);
            } else if (run.length > 0) {
                run.push(pt);
                if (run.length >= 2) runs.push(run);
                run = [];
            }
        }
        if (run.length >= 2) runs.push(run);
    }
    return runs;
}

// Per-road bounding boxes, computed once per road list so viewport culling
// on every pan is a cheap box test rather than a pass over every point.
export interface IndexedRoad { idx: number; road: [number, number][]; south: number; north: number; west: number; east: number }

export function indexRoadBounds(roads: [number, number][][]): IndexedRoad[] {
    return roads.map((road, idx) => {
        let south = 90, north = -90, west = 180, east = -180;
        for (const [lat, lon] of road) {
            if (lat < south) south = lat;
            if (lat > north) north = lat;
            if (lon < west) west = lon;
            if (lon > east) east = lon;
        }
        return { idx, road, south, north, west, east };
    });
}

export function roadsIntersecting(index: IndexedRoad[], bbox: BBox): IndexedRoad[] {
    return index.filter(r => r.north >= bbox.south && r.south <= bbox.north && r.east >= bbox.west && r.west <= bbox.east);
}

export const flattenRiddenTiles = (tiles: RiddenTileRoads): [number, number][][] => Object.values(tiles).flat();

export const tileKey = (t: TileCoord) => `${t.ty},${t.tx}`;

// Given a set of already-fetched tile keys, return the tiles in bbox that
// still need fetching.
export function missingTiles(bbox: BBox, fetched: Set<string>): TileCoord[] {
    return tilesForBBox(bbox).filter(t => !fetched.has(tileKey(t)));
}

// Smallest bbox (on the tile grid) covering a set of tiles.
export function bboxForTiles(tiles: TileCoord[]): BBox {
    return {
        south: Math.min(...tiles.map(t => t.ty)) * ROAD_TILE,
        north: Math.max(...tiles.map(t => t.ty + 1)) * ROAD_TILE,
        west: Math.min(...tiles.map(t => t.tx)) * ROAD_TILE,
        east: Math.max(...tiles.map(t => t.tx + 1)) * ROAD_TILE,
    };
}

// Whether any road passes within `tolerancePx` of `cursor`, in screen pixels (#181).
// `toPixel` projects [lat, lon] to the same pixel space as `cursor`; `searchBox` is the
// tolerance expressed as a lat/lon box around the cursor, used to skip far roads cheaply.
export function isNearRoad(
    index: IndexedRoad[],
    cursor: { x: number; y: number },
    searchBox: BBox,
    toPixel: (latLon: [number, number]) => { x: number; y: number },
    tolerancePx: number,
): boolean {
    const tolSq = tolerancePx * tolerancePx;
    for (const { road } of roadsIntersecting(index, searchBox)) {
        let prev = toPixel(road[0]);
        for (let i = 1; i < road.length; i++) {
            const next = toPixel(road[i]);
            if (distanceToSegmentSq(cursor, prev, next) <= tolSq) return true;
            prev = next;
        }
    }
    return false;
}

function distanceToSegmentSq(p: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }): number {
    const dx = b.x - a.x, dy = b.y - a.y;
    const lenSq = dx * dx + dy * dy;
    const t = lenSq === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq));
    const cx = a.x + t * dx - p.x, cy = a.y + t * dy - p.y;
    return cx * cx + cy * cy;
}
