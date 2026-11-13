import { StreetGraph } from './graph';
import { buildAreaLegs } from './areaLegs';
import { OverpassResponse } from './types';
import { haversineM } from './geometry';

// 4 rows × 11 columns of streets. Columns: start (0), area one (2–4), a
// waypoint between the areas (6), area two (8–10).
const LAT0 = 47.65, LON0 = -117.42, STEP = 0.002, ROWS = 4, COLS = 11;
const nodeId = (i: number, j: number) => 1000 + i * COLS + j;
const coord = (i: number, j: number) => ({ lat: LAT0 + STEP * i, lon: LON0 + STEP * j });
const way = (id: number, cells: [number, number][]) =>
    ({ type: 'way', id, nodes: cells.map(([i, j]) => nodeId(i, j)), geometry: cells.map(([i, j]) => coord(i, j)), tags: { highway: 'residential' } });

function buildGrid(): StreetGraph {
    const ways: unknown[] = [];
    let id = 1;
    for (let i = 0; i < ROWS; i++) ways.push(way(id++, Array.from({ length: COLS }, (_, j) => [i, j] as [number, number])));
    for (let j = 0; j < COLS; j++) ways.push(way(id++, Array.from({ length: ROWS }, (_, i) => [i, j] as [number, number])));
    const g = new StreetGraph();
    g.buildFromOSM({ version: 0.6, generator: 'test', osm3s: { timestamp_osm_base: '', copyright: '' }, elements: ways } as OverpassResponse);
    return g;
}

const boxOver = (fromCol: number, toCol: number) => ({
    south: LAT0 - 0.0005, north: LAT0 + STEP * (ROWS - 1) + 0.0005,
    west: LON0 + STEP * fromCol - 0.0005, east: LON0 + STEP * toCol + 0.0005,
});
const lassoOver = (fromCol: number, toCol: number): [number, number][] => {
    const b = boxOver(fromCol, toCol);
    return [[b.south, b.west], [b.north, b.west], [b.north, b.east], [b.south, b.east], [b.south, b.west]];
};
const lonLat = (p: { lat: number; lon: number }): [number, number] => [p.lon, p.lat];
const maxEdge = haversineM(LAT0, LON0, LAT0 + STEP, LON0);

type Route = { lat: number; lon: number }[];
const visits = (route: Route, i: number, j: number) => {
    const c = coord(i, j);
    return route.flatMap((p, k) => (Math.abs(p.lat - c.lat) < 1e-9 && Math.abs(p.lon - c.lon) < 1e-9 ? [k] : []));
};
const firstVisits = (route: Route, fromCol: number, toCol: number) => {
    const firsts: number[] = [];
    for (let i = 0; i < ROWS; i++) for (let j = fromCol; j <= toCol; j++) firsts.push(visits(route, i, j)[0] ?? -1);
    return firsts;
};

describe('solveOrderedLegs (#52)', () => {
    const start = coord(0, 0), between = coord(0, 6), finish = coord(3, 10);
    // start | area one | between | area two | finish
    const points = [start, between, finish];
    const segments: [number, number][][] = [[], []];
    const anchors = { boxes: [1], polygons: [2] };
    const solve = (g: StreetGraph) =>
        g.solveOrderedLegs(buildAreaLegs(points, segments, [boxOver(2, 4)], [lassoOver(8, 10)], anchors));

    it('sweeps the first area, rides to the point between, then sweeps the second', () => {
        const route = solve(buildGrid());
        const firstsOne = firstVisits(route, 2, 4);
        const firstsTwo = firstVisits(route, 8, 10);
        expect(firstsOne.every(k => k >= 0)).toBe(true); // every street corner in area one is ridden
        expect(firstsTwo.every(k => k >= 0)).toBe(true);

        const atBetween = visits(route, 0, 6);
        expect(atBetween.length).toBeGreaterThan(0);
        expect(Math.max(...firstsOne)).toBeLessThan(atBetween[0]);
        expect(Math.min(...firstsTwo)).toBeGreaterThan(atBetween[0]);
    });

    it('starts at the first point and ends at the last', () => {
        const route = solve(buildGrid());
        expect(route[0]).toMatchObject(start);
        expect(haversineM(route[route.length - 1].lat, route[route.length - 1].lon, finish.lat, finish.lon)).toBeLessThan(1);
    });

    it('is one continuous ride with no jumps between legs', () => {
        const route = solve(buildGrid());
        for (let k = 1; k < route.length; k++) {
            expect(haversineM(route[k - 1].lat, route[k - 1].lon, route[k].lat, route[k].lon)).toBeLessThan(maxEdge * 1.5);
        }
    });

    it('follows the drawn path between waypoints on the way to an area', () => {
        // A detour point above the direct line, with its routed segment supplied.
        const via = coord(3, 1);
        const viaSegment: [number, number][] = [coord(0, 0), coord(1, 0), coord(2, 0), coord(3, 0), via].map(lonLat);
        const route = buildGrid().solveOrderedLegs(buildAreaLegs(
            [start, via, between, finish], [viaSegment, [], []], [boxOver(2, 4)], [lassoOver(8, 10)], { boxes: [2], polygons: [3] },
        ));
        const atVia = visits(route, 3, 1);
        expect(atVia.length).toBeGreaterThan(0);
        expect(atVia[0]).toBeLessThan(Math.min(...firstVisits(route, 2, 4).filter(k => k >= 0)));
    });

});
