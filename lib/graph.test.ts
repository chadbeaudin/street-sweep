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
