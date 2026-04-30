import { StreetGraph } from './graph';
import { OverpassResponse } from './types';

describe('Routing Logic - Overlapping Virtual Edges', () => {
    test('greedy matching causes multiple traversals of the same edge', () => {
        const graph = new StreetGraph();

        // Create a star-like graph or H-graph where greedy matching fails.
        //   A - B - C - D - E
        //   |               |
        //   F               G
        //   |               |
        //   H - I - J - K - L
        
        // Wait, a simpler one:
        // A long corridor with many branches.
        //        B   C   D
        //        |   |   |
        // A ---- M - N - O ---- E
        //        |   |   |
        //        F   G   H
        // 
        // Odd nodes: A, E, B, C, D, F, G, H
        // 8 odd nodes.
        // Optimal matching: (B,F), (C,G), (D,H), (A,E)? No, A and E are odd, so (A,B) maybe?
        // Let's just make sure greedy matching pairs them badly.

        // Actually, if we just use the current implementation and log the max traversals of any edge, we can see it.
        const mockData: OverpassResponse = {
            version: 0.6,
            generator: 'test',
            osm3s: { timestamp_osm_base: '', copyright: '' },
            elements: [
                { type: 'node', id: 1, lat: 0.000, lon: 0.000 },
                { type: 'node', id: 2, lat: 0.000, lon: 0.001 },
                { type: 'node', id: 3, lat: 0.000, lon: 0.002 },
                { type: 'node', id: 4, lat: 0.000, lon: 0.003 },
                { type: 'node', id: 5, lat: 0.000, lon: 0.004 },
                
                { type: 'node', id: 12, lat: 0.001, lon: 0.001 },
                { type: 'node', id: 13, lat: 0.001, lon: 0.002 },
                { type: 'node', id: 14, lat: 0.001, lon: 0.003 },

                { type: 'node', id: 22, lat: -0.001, lon: 0.001 },
                { type: 'node', id: 23, lat: -0.001, lon: 0.002 },
                { type: 'node', id: 24, lat: -0.001, lon: 0.003 },

                { type: 'way', id: 100, nodes: [1, 2, 3, 4, 5] }, // Corridor
                { type: 'way', id: 101, nodes: [12, 2] },
                { type: 'way', id: 102, nodes: [13, 3] },
                { type: 'way', id: 103, nodes: [14, 4] },
                { type: 'way', id: 104, nodes: [22, 2] },
                { type: 'way', id: 105, nodes: [23, 3] },
                { type: 'way', id: 106, nodes: [24, 4] },
            ]
        };

        graph.buildFromOSM(mockData);
        
        const circuit = graph.solveCPP();
        
        // Count edge traversals
        const edgeCounts = new Map<string, number>();
        for (let i = 0; i < circuit.length - 1; i++) {
            const p1 = circuit[i];
            const p2 = circuit[i+1];
            // Format ID by sorting coordinates
            const id = [p1.lat, p1.lon, p2.lat, p2.lon].sort().join(',');
            edgeCounts.set(id, (edgeCounts.get(id) || 0) + 1);
        }

        let maxCount = 0;
        let maxEdge = '';
        for (const [edge, count] of edgeCounts.entries()) {
            if (count > maxCount) {
                maxCount = count;
                maxEdge = edge;
            }
        }

        console.log(`Max traversals of a single edge: ${maxCount}`);
        expect(maxCount).toBeLessThan(4); // We shouldn't traverse any edge 4 times!
    });
});
