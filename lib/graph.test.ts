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
});
