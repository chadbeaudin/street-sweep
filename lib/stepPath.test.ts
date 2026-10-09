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

describe('step routing to a click on a disconnected footpath (graph)', () => {
    const way = (id: number, highway: string, coords: { id: number; lat: number; lon: number }[]) => ({
        type: 'way', id, nodes: coords.map(c => c.id),
        geometry: coords.map(c => ({ lat: c.lat, lon: c.lon })),
        tags: { highway },
    });
    // East 18th runs east-west; Rockwood Blvd runs parallel to the south. A footpath
    // island sits just north of Rockwood Blvd but shares no node with any street.
    const E18_W = { id: 1, lat: 47.6388, lon: -117.3840 };
    const E18_E = { id: 2, lat: 47.6388, lon: -117.3810 };
    const SE_BLVD = { id: 3, lat: 47.6340, lon: -117.3810 };
    const ROCKWOOD_W = { id: 4, lat: 47.6340, lon: -117.3860 };
    const PATH_A = { id: 10, lat: 47.6344, lon: -117.3838 };
    const PATH_B = { id: 11, lat: 47.6343, lon: -117.3843 };
    const osm = {
        version: 0.6, generator: 'test', osm3s: { timestamp_osm_base: '', copyright: '' },
        elements: [
            way(20, 'residential', [E18_W, E18_E]),
            way(21, 'residential', [E18_E, SE_BLVD]),
            way(22, 'residential', [SE_BLVD, ROCKWOOD_W]),
            way(23, 'footway', [PATH_A, PATH_B]),
        ],
    } as unknown as OverpassResponse;
    const prev = { lat: 47.6388, lon: -117.3812 };
    const click = { lat: 47.63434, lon: -117.38414 };

    it('snaps onto the footpath island, which the start cannot reach', () => {
        const graph = new StreetGraph();
        graph.buildFromOSM(osm);
        const snap = graph.findClosestPointOnEdge(click.lat, click.lon)!;
        expect([snap.u, snap.v].sort()).toEqual(['10', '11']);
        expect(graph.findClosestTargetCapped('2', new Set([snap.u, snap.v]), undefined)).toBeNull();
    });

    it('moves the waypoint onto the closest reachable street instead', () => {
        const graph = new StreetGraph();
        graph.buildFromOSM(osm);
        const reachable = graph.findClosestReachablePointOnEdge('2', click.lat, click.lon, 10)!;
        expect([reachable.u, reachable.v].sort()).toEqual(['3', '4']);
        expect(reachable.lat).toBeCloseTo(ROCKWOOD_W.lat, 6);
        expect(reachable.lon).toBeCloseTo(click.lon, 4);
    });

    it('routes along the streets rather than drawing a straight line', () => {
        const graph = new StreetGraph();
        graph.buildFromOSM(osm);
        const prevSnap = graph.findClosestPointOnEdge(prev.lat, prev.lon)!;
        const startId = '2';
        const endSnap = graph.findClosestReachablePointOnEdge(startId, click.lat, click.lon, 10)!;
        const result = graph.findClosestTargetCapped(startId, new Set([endSnap.u, endSnap.v]), undefined)!;
        const coords = buildStepPathCoords(prevSnap, endSnap, startId, result.targetId, result.path, id => graph.graph.getNode(id)?.data);
        // Every leg runs along a street: due east-west or due north-south, never diagonal.
        for (let i = 1; i < coords.length; i++) {
            const sameLat = Math.abs(coords[i][1] - coords[i - 1][1]) < 1e-9;
            const sameLon = Math.abs(coords[i][0] - coords[i - 1][0]) < 1e-9;
            expect(sameLat || sameLon).toBe(true);
        }
        expect(coords.map(c => c[1])).toContain(SE_BLVD.lat);
    });
});
