import { StreetGraph } from './graph';
import { OverpassResponse } from './types';
import { haversineM } from './geometry';

function makeWay(id: number, coords: { lat: number; lon: number }[], nodeIds: number[]): any {
    return { type: 'way', id, nodes: nodeIds, geometry: coords, tags: { highway: 'residential' } };
}

// 4×4 city grid: nodes at lat 47.650 + 0.002*i, lon -117.420 + 0.002*j.
const LAT0 = 47.65, LON0 = -117.42, STEP = 0.002, N = 4;
const nodeId = (i: number, j: number) => 1000 + i * N + j;
const coord = (i: number, j: number) => ({ lat: LAT0 + STEP * i, lon: LON0 + STEP * j });

function buildGrid(): StreetGraph {
    const ways: any[] = [];
    let wid = 1;
    for (let i = 0; i < N; i++) { // horizontal streets (constant lat)
        ways.push(makeWay(wid++, Array.from({ length: N }, (_, j) => coord(i, j)), Array.from({ length: N }, (_, j) => nodeId(i, j))));
    }
    for (let j = 0; j < N; j++) { // vertical streets (constant lon)
        ways.push(makeWay(wid++, Array.from({ length: N }, (_, i) => coord(i, j)), Array.from({ length: N }, (_, i) => nodeId(i, j))));
    }
    const osm: OverpassResponse = { version: 0.6, generator: 'test', osm3s: { timestamp_osm_base: '', copyright: '' }, elements: ways };
    const g = new StreetGraph();
    g.buildFromOSM(osm);
    return g;
}

// Longest single grid edge — any legitimate consecutive step is at most this.
const maxEdge = Math.max(
    haversineM(LAT0, LON0, LAT0 + STEP, LON0),   // vertical step
    haversineM(LAT0, LON0, LAT0, LON0 + STEP),   // horizontal step
);

describe('mixed point+area routing (#26 diagonal lines)', () => {
    it('produces no long diagonal jumps between consecutive points', () => {
        const g = buildGrid();
        const box = { south: LAT0 - 0.0005, north: LAT0 + STEP * (N - 1) + 0.0005, west: LON0 - 0.0005, east: LON0 + STEP * (N - 1) + 0.0005 };

        // Point route: two points along the bottom edge leading into the area.
        const p0 = coord(0, 0), p1 = coord(0, 1);
        const manualRoute: [number, number][] = [[p0.lon, p0.lat], [p1.lon, p1.lat]];

        const path = g.solveCPP({ lat: p0.lat, lon: p0.lon }, undefined, manualRoute, [box]);
        expect(path.length).toBeGreaterThan(2);

        // A diagonal bridge across the grid would be far longer than one edge.
        // The grid diagonal is ~3x an edge; allow 1.5x an edge as the ceiling.
        let maxGap = 0;
        for (let k = 1; k < path.length; k++) {
            const d = haversineM(path[k - 1].lat, path[k - 1].lon, path[k].lat, path[k].lon);
            if (d > maxGap) maxGap = d;
        }
        expect(maxGap).toBeLessThan(maxEdge * 1.5);
    });

    it('covers every grid street (all required edges swept)', () => {
        const g = buildGrid();
        const box = { south: LAT0 - 0.0005, north: LAT0 + STEP * (N - 1) + 0.0005, west: LON0 - 0.0005, east: LON0 + STEP * (N - 1) + 0.0005 };
        const p0 = coord(0, 0), p1 = coord(1, 0);
        const path = g.solveCPP({ lat: p0.lat, lon: p0.lon }, undefined, [[p0.lon, p0.lat], [p1.lon, p1.lat]], [box]);

        // Every grid node should be visited by the sweep.
        const visited = new Set(path.map(p => `${p.lat.toFixed(4)},${p.lon.toFixed(4)}`));
        let missing = 0;
        for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
            const c = coord(i, j);
            if (!visited.has(`${c.lat.toFixed(4)},${c.lon.toFixed(4)}`)) missing++;
        }
        expect(missing).toBe(0);
    });
});
