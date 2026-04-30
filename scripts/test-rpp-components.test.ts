import { StreetGraph } from '../lib/graph';
import { OverpassResponse } from '../lib/types';

describe('RPP Component Bridging', () => {
    test('correctly bridges disconnected required edges', () => {
        const graph = new StreetGraph();
        const mockData: OverpassResponse = {
            version: 0.6,
            generator: 'test',
            osm3s: { timestamp_osm_base: '', copyright: '' },
            elements: [
                { type: 'node', id: 1, lat: 0, lon: 0 },
                { type: 'node', id: 2, lat: 0, lon: 1 },
                { type: 'node', id: 3, lat: 0, lon: 2 },
                { type: 'node', id: 4, lat: 0, lon: 3 },
                
                // 1-2 is unridden (required)
                // 2-3 is ridden (not required)
                // 3-4 is unridden (required)
                { type: 'way', id: 101, nodes: [1, 2] },
                { type: 'way', id: 102, nodes: [2, 3] },
                { type: 'way', id: 103, nodes: [3, 4] }
            ]
        };

        // Mark 2-3 as ridden
        const riddenRoads: [number, number][][] = [
            [[0, 1], [0, 2]]
        ];

        graph.buildFromOSM(mockData, riddenRoads);

        const route = graph.solveCPP();
        
        // Let's see how long the route is.
        // Required: 1-2 (1 unit), 3-4 (1 unit).
        // If they are disconnected, bridge is 2-3 (1 unit).
        // Total required + bridge = 1-2, 2-3, 3-4. (nodes 1, 4 are odd. 2, 3 are even).
        // Wait, degree of 1 is 1 (odd). 4 is 1 (odd). 2 has 1-2 and 2-3 (even). 3 has 2-3 and 3-4 (even).
        // Odd nodes: 1 and 4.
        // Matching: 1 to 4 adds virtual path 1-2-3-4 (3 units).
        // Total trail: 1-2, 2-3, 3-4, then virtual 4-3, 3-2, 2-1.
        // Sequence should be 1-2-3-4-3-2-1. Length = 7 nodes.
        
        console.log(`Route length: ${route.length}`);
        
        // If bug exists, 1-2 and 3-4 are in same component (because 2-3 connects them in base graph).
        // No bridging occurs! edgesInFinalGraph has only 1-2 and 3-4.
        // Odd nodes: 1, 2, 3, 4.
        // Matching might pair 1-2 (virtual 1-2) and 3-4 (virtual 3-4).
        // edgesInFinalGraph becomes two disconnected loops: 1-2-1 and 3-4-3.
        // eulerianTrail throws! Emergency repair bridges them: adds 2-3 and 3-2.
        // Final edges: 1-2(x2), 3-4(x2), 2-3(x2).
        // Sequence length: 1-2-1-2-3-4-3-4? Total 9 nodes!
        // Let's see what it outputs.
    });
});
