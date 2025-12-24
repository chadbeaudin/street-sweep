import { StreetGraph } from './graph';
import { OverpassResponse } from './types';

describe('StreetGraph Efficiency', () => {
    let graph: StreetGraph;

    beforeEach(() => {
        graph = new StreetGraph();
    });

    test('demonstrates suboptimality in odd-node matching', () => {
        /**
         * Setup a scenario where the greedy matching should fail to find the optimal solution.
         * Nodes:
         * A(0,0), B(0, 0.0011), C(0.001, 0.0011), D(0.001, 0)
         * Weights:
         * AB = 1.1, BC = 1, CD = 1.1, DA = 1 (roughly in units)
         * 
         * If we have additional nodes making A, B, C, D odd:
         * e.g., A-X, B-Y, C-Z, D-W where X, Y, Z, W are leaves.
         * But let's just use the square itself and assume we need to double some edges to cover it.
         * Wait, if it's just a square, all degrees are 2.
         * Let's make it a "H" shape or similar.
         */

        // Let's create a graph with 4 odd nodes:
        // 1 -- 2
        // |    |
        // 3 -- 4
        // |    |
        // 5    6
        // Degrees: 1:2, 2:2, 3:3, 4:3, 5:1, 6:1.
        // Odd nodes: 3, 4, 5, 6.
        // Positions:
        // 5: (0, 0)
        // 3: (0, 1)
        // 4: (1, 1)
        // 6: (1, 0)
        // 1: (0, 2)
        // 2: (1, 2)

        // Distances:
        // 5-3 = 1
        // 3-1 = 1
        // 1-2 = 1
        // 2-4 = 1
        // 4-6 = 1
        // 3-4 = 1.1 (Slightly longer)

        // Odd nodes: 3, 4, 5, 6.
        // Pairs:
        // (3,5) dist 1
        // (4,6) dist 1
        // (3,4) dist 1.1
        // (5,6) dist 1.41
        // (3,6) dist 1.41
        // (4,5) dist 1.41

        // Optimal matching: (3,5) and (4,6) -> total extra dist 2.
        // Greedy matching might pick (3,4) first if it starts with 3. 
        // Then it must pick (5,6). -> total extra dist 1.1 + 1.41 = 2.51.

        const mockData: OverpassResponse = {
            version: 0.6,
            generator: 'test',
            osm3s: { timestamp_osm_base: '', copyright: '' },
            elements: [
                { type: 'node', id: 1, lat: 0.002, lon: 0 },
                { type: 'node', id: 2, lat: 0.002, lon: 0.001 },
                { type: 'node', id: 3, lat: 0.001, lon: 0 },
                { type: 'node', id: 4, lat: 0.001, lon: 0.0011 }, // Offset to make 3-4 longer
                { type: 'node', id: 5, lat: 0, lon: 0 },
                { type: 'node', id: 6, lat: 0, lon: 0.0011 },

                { type: 'way', id: 101, nodes: [5, 3] },
                { type: 'way', id: 102, nodes: [3, 1] },
                { type: 'way', id: 103, nodes: [1, 2] },
                { type: 'way', id: 104, nodes: [2, 4] },
                { type: 'way', id: 105, nodes: [4, 6] },
                { type: 'way', id: 106, nodes: [3, 4] }
            ]
        };

        graph.buildFromOSM(mockData);

        // We need to measure 'extra' distance.
        // Actually we can just look at the final graph edges in solveCPP if we expose it or mock console.log
        // Better: calculate total circuit length.

        const circuit = graph.solveCPP();

        let totalDist = 0;
        for (let i = 0; i < circuit.length - 1; i++) {
            totalDist += haversine(circuit[i].lat, circuit[i].lon, circuit[i + 1].lat, circuit[i + 1].lon);
        }

        console.log('Total circuit distance:', totalDist);

        // Theoretical min: sum of all edges + min matching
        // Edges: 5-3(111), 3-1(111), 1-2(111), 2-4(111), 4-6(111), 3-4(122) -> total ~ 677m (very rough)
        // Min matching: (3,5) and (4,6) -> 111+111 = 222m
        // Total min ~ 899m
        // Suboptimal matching: (3,4) and (5,6) -> 122 + 158 = 280m
        // Total suboptimal ~ 957m

        // Since I don't know the exact haversine values here, I'll just run it and see.
    });

    test('demonstrates improvement in island connection', () => {
        /**
         * Mainland: Square 1-2-3-4
         * Island: Line 5-6
         * 
         * Distance from 5 to mainland is shortest via 3.
         * Distance from 6 to mainland is shortest via 4.
         * 
         * If we only try island[0] (node 5), it might connect via 3.
         * But if node 6 is much closer to another node on the mainland, 
         * we should use that connection if it saves total distance.
         * 
         * Let's set it up:
         * 1(0.002, 0), 2(0.002, 0.001), 3(0.001, 0), 4(0.001, 0.001)
         * Island: 5(0, -0.0001), 6(0.001, 0.0015)
         * 
         * 5 is near 3 (dist 111m)
         * 6 is near 4 (dist 55m)
         * 
         * If we start connection search from node 5, it connects to 3.
         * If we search from node 6, it connects to 4.
         * Connection 6-4 is shorter (55m vs 111m).
         */

        const graph2 = new StreetGraph();
        const mockData: OverpassResponse = {
            version: 0.6,
            generator: 'test',
            osm3s: { timestamp_osm_base: '', copyright: '' },
            elements: [
                // Mainland (Square loop)
                { type: 'node', id: 1, lat: 0.002, lon: 0 },
                { type: 'node', id: 2, lat: 0.002, lon: 0.001 },
                { type: 'node', id: 3, lat: 0.001, lon: 0 },
                { type: 'node', id: 4, lat: 0.001, lon: 0.001 },
                { type: 'way', id: 100, nodes: [1, 2, 4, 3, 1] },

                // Island (Disconnected)
                { type: 'node', id: 5, lat: 0, lon: 0 },
                { type: 'node', id: 6, lat: 0.001, lon: 0.0015 },
                { type: 'way', id: 101, nodes: [5, 6] },

                // Connection paths (available in OSM but currently ridden, so used as bridge)
                { type: 'node', id: 7, lat: 0.0005, lon: 0 },
                { type: 'way', id: 102, nodes: [5, 7, 3], tags: { name: 'Path to 5' } },
                { type: 'way', id: 103, nodes: [6, 4], tags: { name: 'Path to 6' } }
            ]
        };

        // Mark connection paths as ridden so they are only used as bridges (virtual edges)
        graph2.buildFromOSM(mockData, [
            [[0, 0], [0.0005, 0], [0.001, 0]], // 5-7-3
            [[0.001, 0.0015], [0.001, 0.001]]  // 6-4
        ]);

        const circuit = graph2.solveCPP();

        // The solver should have connected the island via 6-4 (shorter)
        // instead of 5-3.

        // We can check if node 4 or 3 is in the circuit more times, 
        // or check total distance.
        let totalDist = 0;
        for (let i = 0; i < circuit.length - 1; i++) {
            totalDist += haversine(circuit[i].lat, circuit[i].lon, circuit[i + 1].lat, circuit[i + 1].lon);
        }
        console.log('Total circuit distance (Island):', totalDist);
    });
});

function haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371e3;
    const φ1 = lat1 * Math.PI / 180;
    const φ2 = lat2 * Math.PI / 180;
    const Δφ = (lat2 - lat1) * Math.PI / 180;
    const Δλ = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}
