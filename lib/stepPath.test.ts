import { buildStepPathCoords, EdgeSnap } from './stepPath';
import { StreetGraph } from './graph';
import { OverpassResponse } from './types';

const nodes: Record<string, { lat: number; lon: number }> = {
    A: { lat: 0, lon: 0 },
    B: { lat: 0, lon: 1 },
    C: { lat: 0, lon: 2 },
};
const getNode = (id: string) => nodes[id];

describe('buildStepPathCoords', () => {
    it('starts from the click instead of backtracking to the snap edge node behind it', () => {
        const prev: EdgeSnap = { lat: 0, lon: 0.2, u: 'A', v: 'B' };
        const next: EdgeSnap = { lat: 0, lon: 1.5, u: 'B', v: 'C' };
        const coords = buildStepPathCoords(prev, next, 'A', 'B', [{ id: 'A', idNext: 'B' }], getNode);
        expect(coords).toEqual([[0.2, 0], [1, 0], [1.5, 0]]);
    });

    it('still visits the start node when the path leaves the snap edge through it', () => {
        const prev: EdgeSnap = { lat: 0, lon: 1.2, u: 'B', v: 'C' };
        const next: EdgeSnap = { lat: 0, lon: 0.5, u: 'A', v: 'B' };
        const coords = buildStepPathCoords(prev, next, 'B', 'B', [], getNode);
        expect(coords).toEqual([[1.2, 0], [1, 0], [0.5, 0]]);
    });

    it('does not overshoot past the next click at the end', () => {
        const prev: EdgeSnap = { lat: 0, lon: 0.5, u: 'A', v: 'B' };
        const next: EdgeSnap = { lat: 0, lon: 1.5, u: 'B', v: 'C' };
        const coords = buildStepPathCoords(prev, next, 'B', 'C', [{ id: 'B', idNext: 'C' }], getNode);
        expect(coords).toEqual([[0.5, 0], [1, 0], [1.5, 0]]);
    });

    it('handles both clicks on the same edge', () => {
        const prev: EdgeSnap = { lat: 0, lon: 0.2, u: 'A', v: 'B' };
        const next: EdgeSnap = { lat: 0, lon: 0.8, u: 'A', v: 'B' };
        const coords = buildStepPathCoords(prev, next, 'B', 'B', [], getNode);
        expect(coords).toEqual([[0.2, 0], [1, 0], [0.8, 0]]);
    });
});

describe('step routing from a mid-block waypoint (graph)', () => {
    // East 36th Ave: Arthur -> Perry -> Pittsburg, with Arthur continuing north.
    const way = (id: number, coords: { id: number; lat: number; lon: number }[]) => ({
        type: 'way', id, nodes: coords.map(c => c.id),
        geometry: coords.map(c => ({ lat: c.lat, lon: c.lon })),
        tags: { highway: 'residential' },
    });
    const ARTHUR = { id: 1, lat: 47.6318, lon: -117.4206 };
    const PERRY = { id: 2, lat: 47.6318, lon: -117.4169 };
    const PITTSBURG = { id: 3, lat: 47.6318, lon: -117.4130 };
    const ARTHUR_N = { id: 4, lat: 47.6327, lon: -117.4206 };
    const osm = {
        version: 0.6, generator: 'test', osm3s: { timestamp_osm_base: '', copyright: '' },
        elements: [way(10, [ARTHUR, PERRY, PITTSBURG]), way(11, [ARTHUR, ARTHUR_N])],
    } as unknown as OverpassResponse;

    it('heads east from a waypoint near Arthur without returning to Arthur first', () => {
        const graph = new StreetGraph();
        graph.buildFromOSM(osm);
        const waypoint = { lat: 47.6318, lon: -117.4200 };
        const destination = { lat: 47.6318, lon: -117.4150 };
        const prevSnap = graph.findClosestPointOnEdge(waypoint.lat, waypoint.lon)!;
        const snap = graph.findClosestPointOnEdge(destination.lat, destination.lon)!;

        // Mirrors /api/step: the snap-edge endpoint nearest the previous click is tried first.
        const startId = [prevSnap.u, prevSnap.v].find(id => graph.graph.getNode(id)!.data.lon === ARTHUR.lon)!;
        const result = graph.findClosestTargetCapped(startId, new Set([snap.u, snap.v]), undefined)!;
        const coords = buildStepPathCoords(prevSnap, snap, startId, result.targetId, result.path, id => graph.graph.getNode(id)?.data);

        for (let i = 1; i < coords.length; i++) {
            expect(coords[i][0]).toBeGreaterThan(coords[i - 1][0]);
        }
        expect(coords[0][0]).toBeCloseTo(waypoint.lon, 6);
        expect(coords[coords.length - 1][0]).toBeCloseTo(destination.lon, 6);
    });
});
