export const ROAD_TILE = 0.01; // ~1.1km cells
export const ROAD_TILE_BUFFER = 0.002;

export interface BBox { south: number; west: number; north: number; east: number }
export interface TileCoord { ty: number; tx: number }

// Tiles covering a bbox (plus a small buffer), at the ROAD_TILE grid.
export function tilesForBBox(bbox: BBox): TileCoord[] {
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
