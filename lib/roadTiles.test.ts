import { tilesForBBox, tileKey, missingTiles, bboxForTiles, ROAD_TILE } from './roadTiles';

describe('roadTiles', () => {
    const bbox = { south: 40.0, west: -74.0, north: 40.02, east: -73.98 };

    it('tilesForBBox covers the requested area', () => {
        const tiles = tilesForBBox(bbox);
        expect(tiles.length).toBeGreaterThan(0);
        const box = bboxForTiles(tiles);
        expect(box.south).toBeLessThanOrEqual(bbox.south);
        expect(box.north).toBeGreaterThanOrEqual(bbox.north);
        expect(box.west).toBeLessThanOrEqual(bbox.west);
        expect(box.east).toBeGreaterThanOrEqual(bbox.east);
    });

    it('missingTiles excludes already-fetched tiles', () => {
        const all = tilesForBBox(bbox);
        const fetched = new Set(all.slice(0, Math.floor(all.length / 2)).map(tileKey));
        const missing = missingTiles(bbox, fetched);
        expect(missing.length).toBe(all.length - fetched.size);
        for (const t of missing) expect(fetched.has(tileKey(t))).toBe(false);
    });

    it('missingTiles returns empty once every tile is fetched', () => {
        const all = tilesForBBox(bbox);
        const fetched = new Set(all.map(tileKey));
        expect(missingTiles(bbox, fetched)).toEqual([]);
    });

    it('a pan into an adjacent area only requests the new tiles', () => {
        const original = tilesForBBox(bbox);
        const fetched = new Set(original.map(tileKey));

        const panned = { south: 40.0, west: -74.0 + ROAD_TILE, north: 40.02, east: -73.98 + ROAD_TILE };
        const missing = missingTiles(panned, fetched);

        expect(missing.length).toBeGreaterThan(0);
        expect(missing.length).toBeLessThan(tilesForBBox(panned).length);
    });

    it('bboxForTiles returns the bounding box of the given tiles', () => {
        const tiles = [{ ty: 1, tx: 2 }, { ty: 3, tx: 4 }];
        expect(bboxForTiles(tiles)).toEqual({
            south: 1 * ROAD_TILE,
            north: 4 * ROAD_TILE,
            west: 2 * ROAD_TILE,
            east: 5 * ROAD_TILE,
        });
    });
});
