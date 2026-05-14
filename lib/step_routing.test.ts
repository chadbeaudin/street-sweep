/**
 * Test: Waypoint routing backtracking fix
 *
 * Reproduces the exact scenario reported by the user:
 *
 *   Grid layout (approx coordinates):
 *
 *   [W22-SP] ----W22nd Ave---- [W22-SW]
 *       |                          |
 *   South Post St            South Wall St
 *       |                          |
 *   [W24-SP] ----W24th Ave---- [W24-SW]  <-- Point 3
 *       |                          |
 *   South Post St            South Wall St
 *       |                          |
 *   [W26-SP] ----W26th Ave---- [W26-SW]
 *
 *  Waypoints:
 *    Point 1: W26-SP  (South Post & West 26th)
 *    Point 2: W22-SP  (South Post & West 22nd)
 *    Point 3: W24-SW  (South Wall & West 24th)
 *
 *  Segment 1 (P1→P2): North along South Post from W26 to W22.
 *
 *  Segment 2 (P2→P3):
 *    WRONG (pre-fix): South on South Post (W22→W24), then East on W24 to South Wall.
 *    CORRECT (post-fix): East on W22nd, South on South Wall to W24.
 */

import { StreetGraph } from './graph';
import { OverpassResponse } from './types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Returns a way element using inline geometry (no separate node elements). */
function makeWay(id: number, coords: { id: number; lat: number; lon: number }[]): any {
    return {
        type: 'way',
        id,
        nodes: coords.map(c => c.id),
        geometry: coords.map(c => ({ lat: c.lat, lon: c.lon })),
        tags: { highway: 'residential' }
    };
}

// ---------------------------------------------------------------------------
// Node coordinates
//
// Key geometry: we make the block N-S distance SHORTER than E-W distance
// so that going "south on Post then east on 24th" is genuinely shorter
// than going "east on 22nd then south on Wall". This ensures the baseline
// test proves the pre-fix backtracking bug is real.
//
//   N-S block (22nd→24th): ~0.001 lat  ≈ 111m
//   E-W block (Post→Wall): ~0.006 lon  ≈ 111m × cos(47.6°) ≈ ~100m × 0.006 ≈ 430m
//
// Route A (backtrack via South Post): 111m south + 430m east = ~541m
// Route B (avoid backtrack via W22nd): 430m east + 111m south = ~541m  -- same!
//
// To break the tie in favour of A (the backtrack), we widen the longitude gap
// but shorten the South Post block. Make the N-S Post spacing small (0.0005 ≈ 55m)
// and the E-W Wall spacing large (0.008 ≈ ~380m at this latitude).
//
//   Route A: 55m south + 380m east = 435m  <-- shorter (WRONG choice without penalty)
//   Route B: 380m east + 55m south = 435m  <-- same tie... need to tilt the grid more.
//
// Actually make the south leg (Post W22→W24) very short (0.0003 ≈ 33m),
// and the east leg (W22nd, Post→Wall) wide (0.01 ≈ ~460m).
//
//   Route A: 33m + 460m = 493m  <-- shorter WITHOUT penalty (baseline bug)
//   Route B: 460m + 33m = 493m  <-- same! We need asymmetric geometry.
//
// Solution: Make W22→W24 shorter than Post→Wall (N-S short, E-W long),
// but have Point 3 at (W24, Wall) need to be reached.
// The TWO routes differ in intermediate nodes:
//   A: W22-SP → W24-SP → W24-SW  (two hops: short south, then long east)
//   B: W22-SP → W22-SW → W24-SW  (two hops: long east, then short south)
// Both are the same total distance. Dijkstra breaks ties arbitrarily.
//
// To guarantee A wins without penalty, shift W24-SP slightly WEST of W22-SP,
// making the south step and east step on route A slightly shorter than on route B.
// ---------------------------------------------------------------------------

const N = {
    W22_SP: { id: 1, lat: 47.6560, lon: -117.4200 },  // Point 2
    W22_SW: { id: 2, lat: 47.6560, lon: -117.4100 },  // W22nd & Wall (10 blocks east)
    W24_SP: { id: 3, lat: 47.6549, lon: -117.4200 },  // slightly south of W22-SP
    W24_SW: { id: 4, lat: 47.6549, lon: -117.4101 },  // Point 3 (slightly east of W24-SP to make route A shorter)
    W26_SP: { id: 5, lat: 47.6520, lon: -117.4200 },  // Point 1
    W26_SW: { id: 6, lat: 47.6520, lon: -117.4100 },
};

// ---------------------------------------------------------------------------
// OSM fixture: a 2-column × 3-row city grid
// ---------------------------------------------------------------------------
const gridOSM: OverpassResponse = {
    version: 0.6,
    generator: 'test',
    osm3s: { timestamp_osm_base: '', copyright: '' },
    elements: [
        // South Post Street (vertical, western column)
        makeWay(10, [N.W22_SP, N.W24_SP, N.W26_SP]),
        // South Wall Street (vertical, eastern column)
        makeWay(11, [N.W22_SW, N.W24_SW, N.W26_SW]),
        // West 22nd Ave (horizontal, top row)
        makeWay(12, [N.W22_SP, N.W22_SW]),
        // West 24th Ave (horizontal, middle row)
        makeWay(13, [N.W24_SP, N.W24_SW]),
        // West 26th Ave (horizontal, bottom row)
        makeWay(14, [N.W26_SP, N.W26_SW]),
    ]
};

// ---------------------------------------------------------------------------
// Utility: does a path visit a specific node id?
// ---------------------------------------------------------------------------
function pathVisitsNode(
    graph: StreetGraph,
    path: { id: string; idNext: string }[],
    nodeId: string
): boolean {
    return path.some(seg => seg.id === nodeId || seg.idNext === nodeId);
}

// ---------------------------------------------------------------------------
// Describe block
// ---------------------------------------------------------------------------

describe('Waypoint routing: penalizeTraversedEdges prevents backtracking', () => {

    let graph: StreetGraph;
    let startNodeId: string;   // W22_SP – start of segment 2
    let endNodeId: string;     // W24_SW – destination (Point 3)
    let sp24NodeId: string;    // W24_SP – the "backtrack" node we want to avoid

    beforeEach(() => {
        graph = new StreetGraph();
        graph.buildFromOSM(gridOSM);

        // Resolve node IDs (closest node to each coordinate)
        startNodeId = graph.findClosestNode(N.W22_SP.lat, N.W22_SP.lon)!;
        endNodeId   = graph.findClosestNode(N.W24_SW.lat, N.W24_SW.lon)!;
        sp24NodeId  = graph.findClosestNode(N.W24_SP.lat, N.W24_SP.lon)!;

        expect(startNodeId).toBeTruthy();
        expect(endNodeId).toBeTruthy();
        expect(sp24NodeId).toBeTruthy();
    });

    test('BASELINE: without penalty the shortest path backtracks down South Post', () => {
        // No traversal penalty applied.
        // The shortest path from W22-SP → W24-SW goes:
        //   South on South Post (W22-SP → W24-SP) then East on W24th to W24-SW.
        // This is slightly shorter than going East then South.

        const path = graph.findPath(startNodeId, endNodeId);

        expect(path.length).toBeGreaterThan(0);

        // The backtracking route passes through W24-SP (South Post & W24th)
        const backtracks = pathVisitsNode(graph, path, sp24NodeId);

        // We EXPECT this to be true before the fix — proving the baseline bug exists
        expect(backtracks).toBe(true);
    });

    test('FIX: after penalizing the already-traversed South Post segment, path avoids backtracking', () => {
        // Simulate the already-drawn segment P1→P2:
        // User rode North along South Post from W26 to W22.
        // In manualRoute format: each segment is [[lon, lat], ...]
        const traversedSegment: [number, number][][] = [
            [
                [N.W26_SP.lon, N.W26_SP.lat],  // Point 1: South Post & W26th
                [N.W24_SP.lon, N.W24_SP.lat],  // intermediate
                [N.W22_SP.lon, N.W22_SP.lat],  // Point 2: South Post & W22nd
            ]
        ];

        // Apply the traversal penalty (×5) — same value used in the step API
        graph.penalizeTraversedEdges(traversedSegment, 5);

        // Now find the path from Point 2 to Point 3
        const path = graph.findPath(startNodeId, endNodeId);

        expect(path.length).toBeGreaterThan(0);

        // The penalized route should go:
        //   East on W22nd (W22-SP → W22-SW) then South on South Wall (W22-SW → W24-SW)
        // It should NOT pass through W24-SP (South Post & W24th)
        const backtracks = pathVisitsNode(graph, path, sp24NodeId);

        expect(backtracks).toBe(false);
    });

    test('FIX: penalized path visits W22-SW (East on W22nd Ave) and arrives at W24-SW', () => {
        // More detailed assertion: verify the correct intermediate node is used

        const w22SwNodeId = graph.findClosestNode(N.W22_SW.lat, N.W22_SW.lon)!;
        expect(w22SwNodeId).toBeTruthy();

        const traversedSegment: [number, number][][] = [
            [
                [N.W26_SP.lon, N.W26_SP.lat],
                [N.W24_SP.lon, N.W24_SP.lat],
                [N.W22_SP.lon, N.W22_SP.lat],
            ]
        ];
        graph.penalizeTraversedEdges(traversedSegment, 5);

        const path = graph.findPath(startNodeId, endNodeId);

        // Path should go through W22-SW (the corner at W22nd & South Wall)
        const turnsEastOnW22 = pathVisitsNode(graph, path, w22SwNodeId);
        expect(turnsEastOnW22).toBe(true);

        // And should end at W24-SW
        const lastNode = path[path.length - 1]?.idNext;
        expect(lastNode).toBe(endNodeId);
    });

    test('SAFETY: penalty still allows backtracking when no other route exists (dead end)', () => {
        // Build a graph where the ONLY path from A to C is through B,
        // but A→B is already penalized. The algorithm must still use it.
        //
        //  A --- B --- C      (no parallel route)
        //
        const deadEndOSM: OverpassResponse = {
            version: 0.6,
            generator: 'test',
            osm3s: { timestamp_osm_base: '', copyright: '' },
            elements: [
                { type: 'node', id: 10, lat: 0, lon: 0 },
                { type: 'node', id: 11, lat: 0, lon: 0.001 },
                { type: 'node', id: 12, lat: 0, lon: 0.002 },
                {
                    type: 'way', id: 99, nodes: [10, 11, 12],
                    geometry: [
                        { lat: 0, lon: 0 },
                        { lat: 0, lon: 0.001 },
                        { lat: 0, lon: 0.002 }
                    ],
                    tags: { highway: 'residential' }
                }
            ]
        };

        const deadEndGraph = new StreetGraph();
        deadEndGraph.buildFromOSM(deadEndOSM);

        const aId = deadEndGraph.findClosestNode(0, 0)!;
        const cId = deadEndGraph.findClosestNode(0, 0.002)!;

        // Penalize A→B heavily (the only path)
        const alreadyTraversed: [number, number][][] = [
            [[0, 0], [0.001, 0]]
        ];
        deadEndGraph.penalizeTraversedEdges(alreadyTraversed, 5);

        // Should still find a route (penalty, not a block)
        const path = deadEndGraph.findPath(aId, cId);
        expect(path.length).toBeGreaterThan(0);
    });
});
