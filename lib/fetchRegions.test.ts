import { buildFetchRegions, bboxArea, CELL_DEG, CORRIDOR_BUFFER_DEG } from './fetchRegions';
import type { BoundingBox } from './types';

function enclosingRect(regions: BoundingBox[]): BoundingBox {
    return {
        south: Math.min(...regions.map(r => r.south)),
        north: Math.max(...regions.map(r => r.north)),
        west: Math.min(...regions.map(r => r.west)),
        east: Math.max(...regions.map(r => r.east)),
    };
}

function covers(regions: BoundingBox[], lat: number, lon: number): boolean {
    return regions.some(r => lat >= r.south && lat <= r.north && lon >= r.west && lon <= r.east);
}

function overlaps(a: BoundingBox, b: BoundingBox): boolean {
    const latOverlap = Math.min(a.north, b.north) - Math.max(a.south, b.south);
    const lonOverlap = Math.min(a.east, b.east) - Math.max(a.west, b.west);
    return latOverlap > 1e-9 && lonOverlap > 1e-9;
}

describe('buildFetchRegions', () => {
    it('covers a single compact area with essentially the area itself', () => {
        const area: BoundingBox = { south: 47.7197, north: 47.7279, west: -121.9721, east: -121.9642 };
        const regions = buildFetchRegions({ areaBboxes: [area] });

        expect(regions.length).toBeGreaterThan(0);
        // Every corner of the requested area must be inside some region.
        for (const lat of [area.south, area.north]) {
            for (const lon of [area.west, area.east]) {
                expect(covers(regions, lat, lon)).toBe(true);
            }
        }
        // Grid snapping adds at most one cell of slop on each side.
        const rect = enclosingRect(regions);
        expect(rect.north - rect.south).toBeLessThanOrEqual((area.north - area.south) + 2 * CELL_DEG + 1e-9);
        expect(rect.east - rect.west).toBeLessThanOrEqual((area.east - area.west) + 2 * CELL_DEG + 1e-9);
    });

    // The actual prod failure: a lasso over Duvall, WA plus a second area
    // several miles southeast, joined by a snapped road path. Fetching the
    // enclosing rectangle dragged in the whole empty rural gap between them
    // and produced a 148,022-edge graph. The corridor must be dramatically
    // smaller while still covering both areas and the road connecting them.
    it('covers two far-apart areas plus their connecting path in far less than the enclosing rectangle', () => {
        const duvall: BoundingBox = { south: 47.7197, north: 47.7479, west: -121.9721, east: -121.9442 };
        const southeast: BoundingBox = { south: 47.6923, north: 47.7045, west: -121.9232, east: -121.9050 };

        // A snapped road path running diagonally between the two areas.
        const connecting: [number, number][] = [];
        for (let i = 0; i <= 20; i++) {
            const t = i / 20;
            connecting.push([47.7197 + (47.7045 - 47.7197) * t, -121.9442 + (-121.9232 - -121.9442) * t]);
        }

        const regions = buildFetchRegions({ areaBboxes: [duvall, southeast], paths: [connecting] });

        // Both areas fully covered.
        for (const area of [duvall, southeast]) {
            for (const lat of [area.south, area.north]) {
                for (const lon of [area.west, area.east]) {
                    expect(covers(regions, lat, lon)).toBe(true);
                }
            }
        }
        // Every point along the connecting road is covered.
        for (const [lat, lon] of connecting) {
            expect(covers(regions, lat, lon)).toBe(true);
        }

        // The whole point: the empty rural gap off to the side of the
        // connecting road is NOT fetched, even though it sits squarely inside
        // the enclosing rectangle. This is the area that inflated the real
        // graph to 148,022 edges.
        const gapRect = enclosingRect(regions);
        const gapLat = 47.70, gapLon = -121.96;
        expect(gapLat).toBeGreaterThan(gapRect.south);
        expect(gapLat).toBeLessThan(gapRect.north);
        expect(gapLon).toBeGreaterThan(gapRect.west);
        expect(gapLon).toBeLessThan(gapRect.east);
        expect(covers(regions, gapLat, gapLon)).toBe(false);

        const corridorArea = regions.reduce((sum, r) => sum + bboxArea(r), 0);
        expect(corridorArea).toBeLessThan(bboxArea(gapRect));
    });

    it('produces disjoint regions so no area is fetched twice', () => {
        const regions = buildFetchRegions({
            areaBboxes: [{ south: 47.70, north: 47.75, west: -122.0, east: -121.95 }],
            paths: [[[47.70, -121.95], [47.68, -121.90], [47.66, -121.85]]],
        });

        for (let i = 0; i < regions.length; i++) {
            for (let j = i + 1; j < regions.length; j++) {
                expect(overlaps(regions[i], regions[j])).toBe(false);
            }
        }
    });

    it('buffers a lone point so the router has streets around it to work with', () => {
        const regions = buildFetchRegions({ points: [[47.7197, -121.9721]] });
        // Points just inside the intended buffer are covered...
        expect(covers(regions, 47.7197 + CORRIDOR_BUFFER_DEG * 0.5, -121.9721)).toBe(true);
        expect(covers(regions, 47.7197, -121.9721 - CORRIDOR_BUFFER_DEG * 0.5)).toBe(true);
        // ...and the region doesn't balloon far past it.
        const rect = enclosingRect(regions);
        expect(rect.north - rect.south).toBeLessThanOrEqual(2 * CORRIDOR_BUFFER_DEG + 2 * CELL_DEG + 1e-9);
    });

    it('does not skip cells between widely-spaced points on a sparse path', () => {
        // Two path points far apart: the segment between them must still be
        // corridored, not just the endpoints (a naive per-vertex buffer would
        // leave a hole in the middle and disconnect the graph).
        const path: [number, number][] = [[47.70, -121.99], [47.70, -121.90]];
        const regions = buildFetchRegions({ paths: [path] });

        for (let lon = -121.99; lon <= -121.90; lon += 0.005) {
            expect(covers(regions, 47.70, lon)).toBe(true);
        }
    });

    it('returns no regions when given nothing', () => {
        expect(buildFetchRegions({})).toEqual([]);
    });

    // Every rectangle is an Overpass request, so a very long corridor must not
    // fan out into hundreds of them. Coarsening the grid is the right response:
    // falling back to the full enclosing rectangle would be worst exactly where
    // the graph is most dangerous (the longest routes).
    it('coarsens the grid instead of exceeding the region cap on a very long route', () => {
        const far: BoundingBox[] = [
            { south: 47.7197, north: 47.7479, west: -121.9721, east: -121.9442 },
            { south: 47.30, north: 47.33, west: -121.40, east: -121.36 },
        ];
        const regions = buildFetchRegions({ areaBboxes: far, maxRegions: 24 });

        expect(regions.length).toBeLessThanOrEqual(24);
        // Still meaningfully cheaper than the enclosing rectangle.
        const corridorArea = regions.reduce((sum, r) => sum + bboxArea(r), 0);
        expect(corridorArea).toBeLessThan(bboxArea(enclosingRect(regions)) * 0.5);
        // And both endpoints are still covered.
        expect(covers(regions, 47.7197, -121.9721)).toBe(true);
        expect(covers(regions, 47.33, -121.36)).toBe(true);
    });

    // Users routinely draw two lassos far apart without ever routing between
    // them, so there's no snapped path to corridor along. Marking only the two
    // areas would fetch two islands of streets with no roads in between, and
    // the router can't bridge components it has no data for -- it would either
    // silently drop one lasso's streets or fail to produce a route at all.
    describe('two lassos with no connecting path drawn between them', () => {
        const duvall: BoundingBox = { south: 47.7197, north: 47.7479, west: -121.9721, east: -121.9442 };
        const southeast: BoundingBox = { south: 47.6923, north: 47.7045, west: -121.9232, east: -121.9050 };

        // Marked cells are contiguous iff the regions they merge into form one
        // edge-connected blob; check by walking the rectangles themselves.
        function regionsAreContiguous(regions: BoundingBox[]): boolean {
            if (regions.length <= 1) return true;
            const touches = (a: BoundingBox, b: BoundingBox) => {
                const latOverlap = Math.min(a.north, b.north) - Math.max(a.south, b.south);
                const lonOverlap = Math.min(a.east, b.east) - Math.max(a.west, b.west);
                // Edge-adjacent: overlap along one axis, touching on the other.
                return (latOverlap > 1e-9 && lonOverlap > -1e-9) || (lonOverlap > 1e-9 && latOverlap > -1e-9);
            };
            const seen = new Set<number>([0]);
            const queue = [0];
            while (queue.length) {
                const cur = queue.pop()!;
                for (let i = 0; i < regions.length; i++) {
                    if (seen.has(i) || !touches(regions[cur], regions[i])) continue;
                    seen.add(i);
                    queue.push(i);
                }
            }
            return seen.size === regions.length;
        }

        it('bridges the gap so the fetched street network is one connected piece', () => {
            const regions = buildFetchRegions({ areaBboxes: [duvall, southeast] });
            expect(regions.length).toBeGreaterThan(0);
            expect(regionsAreContiguous(regions)).toBe(true);
        });

        it('covers the straight line between the two areas', () => {
            const regions = buildFetchRegions({ areaBboxes: [duvall, southeast] });
            // Sample along the line joining the two areas' nearest corners.
            const from: [number, number] = [duvall.south, duvall.east];
            const to: [number, number] = [southeast.north, southeast.west];
            for (let t = 0; t <= 1; t += 0.05) {
                const lat = from[0] + (to[0] - from[0]) * t;
                const lon = from[1] + (to[1] - from[1]) * t;
                expect(covers(regions, lat, lon)).toBe(true);
            }
        });

        it('still leaves the far side of the gap unfetched', () => {
            const regions = buildFetchRegions({ areaBboxes: [duvall, southeast] });
            // The enclosing rectangle's southwest corner: far from both areas
            // and far from the line bridging them, so the bridging corridor
            // must not have degenerated into the full rectangle.
            expect(covers(regions, 47.6935, -121.9700)).toBe(false);
        });

        it('does not bridge anything when a single area is already contiguous', () => {
            const single = buildFetchRegions({ areaBboxes: [duvall] });
            const bridged = buildFetchRegions({ areaBboxes: [duvall] });
            expect(bridged).toEqual(single);
            const area = bridged.reduce((sum, r) => sum + bboxArea(r), 0);
            // No spurious corridor tacked on: stays within a cell of the area.
            expect(area).toBeLessThanOrEqual(bboxArea({
                south: duvall.south - CELL_DEG, north: duvall.north + CELL_DEG,
                west: duvall.west - CELL_DEG, east: duvall.east + CELL_DEG,
            }));
        });
    });
});
