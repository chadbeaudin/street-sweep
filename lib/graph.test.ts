import { StreetGraph } from './graph';
import { OverpassResponse } from './types';

describe('StreetGraph', () => {
    let graph: StreetGraph;

    beforeEach(() => {
        graph = new StreetGraph();
    });

    test('builds graph and solves CPP for a simple square loop', () => {
        // Square 1-2-3-4-1
        // All nodes even degree (2)
        const mockData: OverpassResponse = {
            version: 0.6,
            generator: 'test',
            osm3s: { timestamp_osm_base: '', copyright: '' },
            elements: [
                { type: 'node', id: 1, lat: 0, lon: 0 },
                { type: 'node', id: 2, lat: 0, lon: 1 },
                { type: 'node', id: 3, lat: 1, lon: 1 },
                { type: 'node', id: 4, lat: 1, lon: 0 },
                { type: 'way', id: 100, nodes: [1, 2, 3, 4, 1] }
            ]
        };

        graph.buildFromOSM(mockData);
        const circuit = graph.solveCPP();

        expect(circuit.length).toBeGreaterThan(0);
        // Should start and end at same point (roughly)
        // Note: solveCPP returns lat/lon points.
        const start = circuit[0];
        const end = circuit[circuit.length - 1];
        // In a circuit of points P1..Pn, we often duplicate P1 at Pn, or Pn connects to P1.
        // Let's just check valid coordinates.
        circuit.forEach(p => {
            expect(p.lat).toBeDefined();
            expect(p.lon).toBeDefined();
        });
    });

    test('solves CPP for a line (odd degrees)', () => {
        // Line 1-2-3-4
        // Nodes 1 and 4 have degree 1 (odd).
        // Should double edges to make it Eulerian.
        const mockData: OverpassResponse = {
            version: 0.6,
            generator: 'test',
            osm3s: { timestamp_osm_base: '', copyright: '' },
            elements: [
                { type: 'node', id: 1, lat: 0, lon: 0 },
                { type: 'node', id: 2, lat: 0, lon: 0.001 },
                { type: 'node', id: 3, lat: 0, lon: 0.002 },
                { type: 'node', id: 4, lat: 0, lon: 0.003 },
                { type: 'way', id: 200, nodes: [1, 2, 3, 4] }
            ]
        };

        graph.buildFromOSM(mockData);
        const circuit = graph.solveCPP();

        expect(circuit.length).toBeGreaterThan(4); // Original points (4), plus return trip
        // Check for no errors thrown
    });
    test('solves RPP with start and end points', () => {
        // Simple 2x2 grid
        // 1 - 2 - 3
        // |   |   |
        // 4 - 5 - 6
        const mockData: OverpassResponse = {
            version: 0.6,
            generator: 'test',
            osm3s: { timestamp_osm_base: '', copyright: '' },
            elements: [
                { type: 'node', id: 1, lat: 0, lon: 0 },
                { type: 'node', id: 2, lat: 0, lon: 0.001 },
                { type: 'node', id: 3, lat: 0, lon: 0.002 },
                { type: 'node', id: 4, lat: 0.001, lon: 0 },
                { type: 'node', id: 5, lat: 0.001, lon: 0.001 },
                { type: 'node', id: 6, lat: 0.001, lon: 0.002 },
                { type: 'way', id: 10, nodes: [1, 2, 3] },
                { type: 'way', id: 11, nodes: [4, 5, 6] },
                { type: 'way', id: 12, nodes: [1, 4] },
                { type: 'way', id: 13, nodes: [2, 5] },
                { type: 'way', id: 14, nodes: [3, 6] }
            ]
        };

        graph.buildFromOSM(mockData);
        // Start at node 1, end at node 6
        const startPoint = { lat: 0, lon: 0 };
        const endPoint = { lat: 0.001, lon: 0.002 };
        const result = graph.solveCPP(startPoint, endPoint);

        expect(result.length).toBeGreaterThan(0);
        // Check if starts near 1 and ends near 6
        expect(result[0].lat).toBeCloseTo(0);
        expect(result[0].lon).toBeCloseTo(0);
        expect(result[result.length - 1].lat).toBeCloseTo(0.001);
        expect(result[result.length - 1].lon).toBeCloseTo(0.002);
    });

    test('solves RPP constrained by manualRoute', () => {
        // Grid:
        // 1 - 2 - 3
        // |   |   |
        // 4 - 5 - 6
        const mockData: OverpassResponse = {
            version: 0.6,
            generator: 'test',
            osm3s: { timestamp_osm_base: '', copyright: '' },
            elements: [
                { type: 'node', id: 1, lat: 0, lon: 0 },
                { type: 'node', id: 2, lat: 0, lon: 0.001 },
                { type: 'node', id: 3, lat: 0, lon: 0.002 },
                { type: 'node', id: 4, lat: 0.001, lon: 0 },
                { type: 'node', id: 5, lat: 0.001, lon: 0.001 },
                { type: 'node', id: 6, lat: 0.001, lon: 0.002 },
                { type: 'way', id: 10, nodes: [1, 2, 3] },
                { type: 'way', id: 11, nodes: [4, 5, 6] },
                { type: 'way', id: 12, nodes: [1, 4] },
                { type: 'way', id: 13, nodes: [2, 5] },
                { type: 'way', id: 14, nodes: [3, 6] }
            ]
        };

        graph.buildFromOSM(mockData);

        // Manual route only uses 1-2, 2-5, 5-4, 4-1 (a small square)
        const manualRoute: [number, number][] = [
            [0, 0],       // node 1
            [0.001, 0],   // node 2
            [0.001, 0.001],// node 5
            [0, 0.001],   // node 4
            [0, 0]        // node 1
        ];

        const result = graph.solveCPP(undefined, undefined, manualRoute);

        expect(result.length).toBeGreaterThan(0);

        // Nodes 3 and 6 (lon=0.002) should NOT be in the result
        result.forEach(p => {
            expect(p.lon).not.toBe(0.002);
        });

        // Check for unnecessary repeats: 
        // In a properly augmented graph, an edge should be traversed at most 2 times
        // (Original + 1 duplicate to match odd nodes).
        const edgeVisits = new Map<string, number>();
        for (let i = 0; i < result.length - 1; i++) {
            const p1 = result[i];
            const p2 = result[i + 1];
            const key = [p1.lat, p1.lon, p2.lat, p2.lon].sort().join(',');
            edgeVisits.set(key, (edgeVisits.get(key) || 0) + 1);
        }

        edgeVisits.forEach((count, key) => {
            expect(count).toBeLessThanOrEqual(2);
        });
    });

    test('ensures trail starts at startNode even if edges are defined in reverse', () => {
        // Line 1-2-3
        const mockData: OverpassResponse = {
            version: 0.6,
            generator: 'test',
            osm3s: { timestamp_osm_base: '', copyright: '' },
            elements: [
                { type: 'node', id: 1, lat: 0, lon: 0 },
                { type: 'node', id: 2, lat: 0, lon: 0.001 },
                { type: 'node', id: 3, lat: 0, lon: 0.002 },
                { type: 'way', id: 10, nodes: [3, 2, 1] } // Defined in reverse
            ]
        };

        graph.buildFromOSM(mockData);
        const startPoint = { lat: 0, lon: 0 }; // node 1
        const endPoint = { lat: 0, lon: 0.002 }; // node 3
        const result = graph.solveCPP(startPoint, endPoint);

        expect(result[0].lat).toBe(0);
        expect(result[0].lon).toBe(0);
        expect(result[result.length - 1].lon).toBe(0.002);
    });

    test('marks the correct edge mandatory when two manualRoute waypoints snap mid-edge to the same intersection', () => {
        // Regression test: previously, when two consecutive manualRoute
        // waypoints both fell mid-edge near the same intersection, both
        // findClosestNode lookups returned the same node (u === v) and the
        // half-edge was silently skipped — the CPP solver never visited that
        // street. A later fix used the midpoint of the two waypoints to pick
        // an edge, but the midpoint could snap to a parallel or crossing road
        // and pin the wrong edge. The current fix snaps each waypoint to its
        // own closest edge and only marks the edge mandatory when both agree.
        const mockData: OverpassResponse = {
            version: 0.6,
            generator: 'test',
            osm3s: { timestamp_osm_base: '', copyright: '' },
            elements: [
                // Target street: long edge 1-2 along lat=0
                { type: 'node', id: 1, lat: 0, lon: 0 },
                { type: 'node', id: 2, lat: 0, lon: 0.01 },
                // Side street 1-3 (should NOT be marked mandatory)
                { type: 'node', id: 3, lat: 0.005, lon: 0 },
                { type: 'way', id: 10, nodes: [1, 2] },
                { type: 'way', id: 11, nodes: [1, 3] },
            ]
        };

        graph.buildFromOSM(mockData);

        // Both waypoints lie on edge 1-2 close to node 1, so findClosestNode
        // returns node 1 for both (u === v). The fix must still recognize
        // they share edge 1-2 and mark it mandatory.
        const manualRoute: [number, number][] = [
            [0.001, 0],   // lon, lat — mid-edge on 1-2, closer to node 1
            [0.002, 0],   // lon, lat — mid-edge on 1-2, closer to node 1
        ];

        const result = graph.solveCPP(undefined, undefined, manualRoute);

        // Without the fix, requiredEdges is empty and solveCPP returns just
        // the raw manualRoute points (length 2). The circuit must reach
        // node 2 at lon=0.01 to prove edge 1-2 was traversed.
        const reachesNode2 = result.some(p =>
            Math.abs(p.lon - 0.01) < 1e-9 && Math.abs(p.lat) < 1e-9
        );
        expect(reachesNode2).toBe(true);

        // Side street 1-3 must NOT be traversed — it was not part of either
        // waypoint's snapped edge.
        const visitsNode3 = result.some(p =>
            Math.abs(p.lat - 0.005) < 1e-9 && Math.abs(p.lon) < 1e-9
        );
        expect(visitsNode3).toBe(false);
    });

    test('truncates route at endPoint when click lands mid-edge (route does not overshoot)', () => {
        // Regression test for "route goes past the end point" bug.
        // When the user clicks an endpoint that falls mid-edge between two
        // intersections, the trail's final node snapped to the closer
        // intersection, which can lie past the click in the traversal
        // direction. The fix projects the endpoint onto its closest edge
        // and truncates the coords at that point so the route ends exactly
        // where the user clicked.
        //
        // Grid:
        //   1 -- 2 -- 3
        //   |    |    |
        //   4 -- 5 -- 6
        const mockData: OverpassResponse = {
            version: 0.6,
            generator: 'test',
            osm3s: { timestamp_osm_base: '', copyright: '' },
            elements: [
                { type: 'node', id: 1, lat: 0, lon: 0 },
                { type: 'node', id: 2, lat: 0, lon: 0.001 },
                { type: 'node', id: 3, lat: 0, lon: 0.002 },
                { type: 'node', id: 4, lat: 0.001, lon: 0 },
                { type: 'node', id: 5, lat: 0.001, lon: 0.001 },
                { type: 'node', id: 6, lat: 0.001, lon: 0.002 },
                { type: 'way', id: 10, nodes: [1, 2, 3] },
                { type: 'way', id: 11, nodes: [4, 5, 6] },
                { type: 'way', id: 12, nodes: [1, 4] },
                { type: 'way', id: 13, nodes: [2, 5] },
                { type: 'way', id: 14, nodes: [3, 6] }
            ]
        };

        graph.buildFromOSM(mockData);

        // Start at node 1, end mid-edge between node 2 and node 3
        // (closer to node 2 — snapping to nodes would overshoot to node 2
        // or undershoot if it picked node 3).
        const startPoint = { lat: 0, lon: 0 };
        const endPoint = { lat: 0, lon: 0.0012 }; // ~22m east of node 2 on edge 2-3
        const result = graph.solveCPP(startPoint, endPoint);

        expect(result.length).toBeGreaterThan(0);

        const last = result[result.length - 1];

        // Route must end exactly at the projected endpoint location, not
        // at intersection node 2 (lon=0.001) or node 3 (lon=0.002).
        expect(last.lat).toBeCloseTo(endPoint.lat, 9);
        expect(last.lon).toBeCloseTo(endPoint.lon, 9);
        expect(last.lon).not.toBeCloseTo(0.001, 9);
        expect(last.lon).not.toBeCloseTo(0.002, 9);
    });

    test('mixed mode (manualRoute + selectionBox) produces open path ending at far corner, not back at entry', () => {
        // 3x3 grid — approach from outside the NW corner, selection box covers all 9 nodes.
        // NW=1(0.002,0) - 2(0.002,0.001) - NE=3(0.002,0.002)
        //      |                |                    |
        //      4(0.001,0) - 5(0.001,0.001) - 6(0.001,0.002)
        //      |                |                    |
        // SW=7(0,0)     - 8(0,0.001)      - SE=9(0,0.002)
        const mockData: OverpassResponse = {
            version: 0.6,
            generator: 'test',
            osm3s: { timestamp_osm_base: '', copyright: '' },
            elements: [
                { type: 'node', id: 1, lat: 0.002, lon: 0 },
                { type: 'node', id: 2, lat: 0.002, lon: 0.001 },
                { type: 'node', id: 3, lat: 0.002, lon: 0.002 },
                { type: 'node', id: 4, lat: 0.001, lon: 0 },
                { type: 'node', id: 5, lat: 0.001, lon: 0.001 },
                { type: 'node', id: 6, lat: 0.001, lon: 0.002 },
                { type: 'node', id: 7, lat: 0, lon: 0 },
                { type: 'node', id: 8, lat: 0, lon: 0.001 },
                { type: 'node', id: 9, lat: 0, lon: 0.002 },
                { type: 'way', id: 10, nodes: [1, 2, 3] },
                { type: 'way', id: 11, nodes: [4, 5, 6] },
                { type: 'way', id: 12, nodes: [7, 8, 9] },
                { type: 'way', id: 13, nodes: [1, 4, 7] },
                { type: 'way', id: 14, nodes: [2, 5, 8] },
                { type: 'way', id: 15, nodes: [3, 6, 9] },
            ]
        };

        graph.buildFromOSM(mockData);

        // Manual route approaches from north (outside the box), arriving at NW corner.
        // Format: [lon, lat]
        const manualRoute: [number, number][] = [
            [0, 0.003], // approach start: slightly north of NW corner, outside the box
            [0, 0.002], // arrives at NW corner (node 1)
        ];

        const selectionBoxes = [{ north: 0.002, south: 0, east: 0.002, west: 0 }];

        const result = graph.solveCPP(undefined, undefined, manualRoute, selectionBoxes);

        expect(result.length).toBeGreaterThan(4);

        // Must start at approachStart (manualRoute[0] in [lon,lat] form)
        expect(result[0].lat).toBeCloseTo(0.003, 4);
        expect(result[0].lon).toBeCloseTo(0, 4);

        // Must end near the SE corner (node 9: lat=0, lon=0.002) —
        // the corner farthest from the NW approach start.
        const end = result[result.length - 1];
        expect(end.lat).toBeCloseTo(0, 2);
        expect(end.lon).toBeCloseTo(0.002, 2);

        // Must NOT end back near the entry point (would indicate a closed circuit bug).
        const distFromEntry = Math.hypot(end.lat - 0.003, end.lon - 0);
        expect(distFromEntry).toBeGreaterThan(0.001);
    });

    test('rotates circuit to start at startNode', () => {
        // Square 1-2-3-4-1
        const mockData: OverpassResponse = {
            version: 0.6,
            generator: 'test',
            osm3s: { timestamp_osm_base: '', copyright: '' },
            elements: [
                { type: 'node', id: 1, lat: 0, lon: 0 },
                { type: 'node', id: 2, lat: 0, lon: 0.1 },
                { type: 'node', id: 3, lat: 0.1, lon: 0.1 },
                { type: 'node', id: 4, lat: 0.1, lon: 0 },
                { type: 'way', id: 10, nodes: [1, 2, 3, 4, 1] }
            ]
        };

        graph.buildFromOSM(mockData);
        // Start at node 3
        const startPoint = { lat: 0.1, lon: 0.1 };
        const result = graph.solveCPP(startPoint, startPoint);

        expect(result[0].lat).toBe(0.1);
        expect(result[0].lon).toBe(0.1);
        expect(result[result.length - 1].lat).toBe(0.1);
        expect(result[result.length - 1].lon).toBe(0.1);
    });
});
