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
