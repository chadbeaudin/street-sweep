import { tilesForBBox, tileKey, missingTiles, bboxForTiles, expandBBox, flattenRiddenTiles, unmatchedRuns, riddenTileKey, indexRoadBounds, roadsIntersecting, ROAD_TILE } from './roadTiles';

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

    it('regression: returns no tiles for a world-scale bbox instead of crashing', () => {
        // A map briefly at a neutral placeholder view (zoom 2, near-global bounds) fed
        // this straight into the tile grid math, producing a tile count in the billions
        // and throwing "RangeError: Invalid array length".
        const worldBbox = { south: -60, west: -170, north: 80, east: 170 };
        expect(tilesForBBox(worldBbox)).toEqual([]);
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

    it('expandBBox grows the bbox by the given fraction on every side', () => {
        const expanded = expandBBox(bbox, 0.5);
        expect(expanded.south).toBeCloseTo(39.99);
        expect(expanded.north).toBeCloseTo(40.03);
        expect(expanded.west).toBeCloseTo(-74.01);
        expect(expanded.east).toBeCloseTo(-73.97);
    });

    it('expandBBox covers tiles adjacent to the viewport', () => {
        const viewportTiles = new Set(tilesForBBox(bbox).map(tileKey));
        const prefetchTiles = tilesForBBox(expandBBox(bbox, 0.5));
        expect(prefetchTiles.length).toBeGreaterThan(viewportTiles.size);
        for (const t of tilesForBBox(bbox)) expect(prefetchTiles.map(tileKey)).toContain(tileKey(t));
    });

    it('expandBBox falls back to the original bbox when the expansion would be rejected as too large', () => {
        const wide = { south: 40.0, west: -74.0, north: 41.5, east: -72.5 };
        expect(expandBBox(wide, 0.5)).toEqual(wide);
        expect(tilesForBBox(expandBBox(wide, 0.5)).length).toBeGreaterThan(0);
    });

    it("flattenRiddenTiles returns each tile's roads once, even after the same tile is received repeatedly", () => {
        let cache = {};
        const poll = { '1,2': [[[1, 2], [3, 4]]] as [number, number][][] };
        cache = { ...cache, ...poll };
        cache = { ...cache, ...poll, '1,3': [[[5, 6]]] as [number, number][][] };
        expect(flattenRiddenTiles(cache)).toEqual([[[1, 2], [3, 4]], [[5, 6]]]);
    });

    describe('unmatchedRuns', () => {
        // Points walking east across three 0.02deg ridden tiles: tx 0, 1, 2.
        const road: [number, number][] = [[0.01, 0.005], [0.01, 0.015], [0.01, 0.025], [0.01, 0.035], [0.01, 0.045], [0.01, 0.055]];

        it('returns every road whole when nothing is matched yet', () => {
            expect(unmatchedRuns([road], new Set())).toEqual([road]);
        });

        it('drops points in matched tiles, keeping the first matched point so the run meets the matched overlay', () => {
            const matched = new Set([riddenTileKey(0.01, 0.025)]); // middle tile
            expect(unmatchedRuns([road], matched)).toEqual([
                [[0.01, 0.005], [0.01, 0.015], [0.01, 0.025]],
                [[0.01, 0.045], [0.01, 0.055]],
            ]);
        });

        it('returns nothing once every tile a road crosses is matched', () => {
            const matched = new Set(road.map(([lat, lon]) => riddenTileKey(lat, lon)));
            expect(unmatchedRuns([road], matched)).toEqual([]);
        });
    });

    describe('roadsIntersecting', () => {
        const near: [number, number][] = [[40.01, -74.01], [40.015, -73.99]];
        const far: [number, number][] = [[41.0, -75.0], [41.01, -75.01]];
        const crossing: [number, number][] = [[39.9, -74.0], [40.1, -74.0]]; // no vertex inside, but spans the box

        it('keeps roads overlapping the bbox, including ones with no vertex inside it, and preserves original indexes', () => {
            const visible = roadsIntersecting(indexRoadBounds([far, near, crossing]), { south: 40.0, north: 40.02, west: -74.02, east: -73.98 });
            expect(visible.map(r => r.idx)).toEqual([1, 2]);
            expect(visible[0].road).toBe(near);
        });
    });
});
