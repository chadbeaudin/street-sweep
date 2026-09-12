import { StreetGraph, pointInPolygon, pointInAnyPolygon, pointNearOrInPolygon, getPolygonBounds, trimBridgeOverlap, applyEndpointSnap, filterRiddenRoadsToBbox } from './graph';
import { isRoutableHighway } from './highwayFilter';
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
                { type: 'way', id: 100, nodes: [1, 2, 3, 4, 1], tags: { highway: 'residential' } }
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
                { type: 'way', id: 200, nodes: [1, 2, 3, 4], tags: { highway: 'residential' } }
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
                { type: 'way', id: 10, nodes: [1, 2, 3], tags: { highway: 'residential' } },
                { type: 'way', id: 11, nodes: [4, 5, 6], tags: { highway: 'residential' } },
                { type: 'way', id: 12, nodes: [1, 4], tags: { highway: 'residential' } },
                { type: 'way', id: 13, nodes: [2, 5], tags: { highway: 'residential' } },
                { type: 'way', id: 14, nodes: [3, 6], tags: { highway: 'residential' } }
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

    describe('findClosestTargetCapped', () => {
        // Real-world bug: a direct route between two points on the same street got
        // penalized (ridden-roads avoidance) so heavily that pathfinding preferred a
        // multi-block detour via a parallel street instead — technically "avoiding the
        // ridden segment" but a huge, unwanted detour for what the user intended as a
        // direct point-to-point hop. findClosestTargetCapped should refuse a penalized
        // detour that isn't actually worth it distance-wise.
        //
        // Grid: direct route 1-2-3-4 is 300m (ridden, penalized). Detour 1-5-6-3 is
        // 300m + 3x200m = a much longer physical route with no penalty.
        const mockData: OverpassResponse = {
            version: 0.6,
            generator: 'test',
            osm3s: { timestamp_osm_base: '', copyright: '' },
            elements: [
                { type: 'node', id: 1, lat: 0, lon: 0 },
                { type: 'node', id: 2, lat: 0, lon: 0.001 },
                { type: 'node', id: 3, lat: 0, lon: 0.002 },
                { type: 'node', id: 4, lat: 0, lon: 0.003 },
                { type: 'node', id: 5, lat: 0.002, lon: 0 },
                { type: 'node', id: 6, lat: 0.002, lon: 0.003 },
                { type: 'way', id: 100, nodes: [1, 2, 3, 4], tags: { highway: 'residential' } },
                { type: 'way', id: 101, nodes: [1, 5], tags: { highway: 'residential' } },
                { type: 'way', id: 102, nodes: [5, 6], tags: { highway: 'residential' } },
                { type: 'way', id: 103, nodes: [6, 4], tags: { highway: 'residential' } },
            ]
        };

        // Builds a penalty map covering BOTH directions of the given node pairs — a
        // multigraph link has a separate link object (and id) per direction, so
        // penalizing only one direction (as the real buildRiddenPenaltyMap /
        // getTraversalPenalties never do, since they iterate forEachLink) lets Dijkstra
        // dodge the penalty entirely via the unpenalized reverse-direction link.
        function penalizeBothDirections(graph: StreetGraph, pairs: [string, string][], multiplier: number): Map<string, number> {
            const penalizedLinks = new Map<string, number>();
            for (const [a, b] of pairs) {
                const l1 = graph.graph.getLink(a, b);
                const l2 = graph.graph.getLink(b, a);
                if (l1) penalizedLinks.set(l1.id, multiplier);
                if (l2) penalizedLinks.set(l2.id, multiplier);
            }
            return penalizedLinks;
        }

        it('ignores the penalty and takes the direct route when the penalized detour is far longer', () => {
            graph.buildFromOSM(mockData);
            // Penalize the direct route (1-2, 2-3) heavily, as ridden-roads avoidance would.
            const penalizedLinks = penalizeBothDirections(graph, [['1', '2'], ['2', '3']], 10);

            const result = graph.findClosestTargetCapped('1', new Set(['4']), penalizedLinks);
            expect(result).not.toBeNull();
            // Direct route visits node 2 and 3; the detour visits node 5 and 6 instead.
            const visitedIds = new Set(result!.path.flatMap(s => [s.id, s.idNext]));
            expect(visitedIds.has('2')).toBe(true);
            expect(visitedIds.has('5')).toBe(false);
        });

        it('still takes the penalized detour when it is a comparably short alternative', () => {
            // Shrink the detour so it's only slightly longer than the direct route.
            const short: OverpassResponse = {
                ...mockData,
                elements: mockData.elements.map(el => {
                    if (el.type === 'node' && (el.id === 5 || el.id === 6)) {
                        return { ...el, lat: 0.0002 };
                    }
                    return el;
                })
            };
            graph.buildFromOSM(short);
            const penalizedLinks = penalizeBothDirections(graph, [['1', '2'], ['2', '3']], 10);

            const result = graph.findClosestTargetCapped('1', new Set(['4']), penalizedLinks);
            expect(result).not.toBeNull();
            const visitedIds = new Set(result!.path.flatMap(s => [s.id, s.idNext]));
            expect(visitedIds.has('5')).toBe(true);
        });
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
                { type: 'way', id: 10, nodes: [1, 2, 3], tags: { highway: 'residential' } },
                { type: 'way', id: 11, nodes: [4, 5, 6], tags: { highway: 'residential' } },
                { type: 'way', id: 12, nodes: [1, 4], tags: { highway: 'residential' } },
                { type: 'way', id: 13, nodes: [2, 5], tags: { highway: 'residential' } },
                { type: 'way', id: 14, nodes: [3, 6], tags: { highway: 'residential' } }
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
                { type: 'way', id: 10, nodes: [3, 2, 1], tags: { highway: 'residential' } } // Defined in reverse
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

    test('regression: does not insert a phantom backtrack when the raw endpoint click re-snaps to a different node than the manual route\'s own end', () => {
        // Straight line 1-2-3-4-5. Node 1 and node 5 are the natural odd-degree
        // ends; the manual route walks the whole line, so requiredEdges' own
        // parity already has exactly these two nodes odd — no matching should
        // be needed at all, just the direct path.
        //
        // Previously, solveCPP re-snapped the raw startPoint/endPoint click
        // coordinates independently (via findEndpointNode), which could land on
        // a DIFFERENT node than the one the manual route itself actually ends
        // at (e.g. node 4, if the click is a bit short of the true end). That
        // flipped parity on the wrong (even-degree) node instead of cancelling
        // the manual route's true odd endpoint, forcing an unnecessary matching
        // edge between the two nearby nodes — an out-and-back detour on a
        // street with nothing unridden to justify it.
        const mockData: OverpassResponse = {
            version: 0.6,
            generator: 'test',
            osm3s: { timestamp_osm_base: '', copyright: '' },
            elements: [
                { type: 'node', id: 1, lat: 0, lon: 0 },
                { type: 'node', id: 2, lat: 0, lon: 0.001 },
                { type: 'node', id: 3, lat: 0, lon: 0.002 },
                { type: 'node', id: 4, lat: 0, lon: 0.003 },
                { type: 'node', id: 5, lat: 0, lon: 0.004 },
                { type: 'way', id: 100, nodes: [1, 2, 3, 4, 5], tags: { highway: 'residential' } }
            ]
        };
        graph.buildFromOSM(mockData);

        const manualRoute: [number, number][] = [
            [0, 0], [0.001, 0], [0.002, 0], [0.003, 0], [0.004, 0]
        ];
        const startPoint = { lat: 0, lon: 0 }; // node 1, exact
        // Deliberately closer to node 4 (lon 0.003) than the true end, node 5
        // (lon 0.004) — simulates the raw click re-snapping to a neighboring node.
        const endPoint = { lat: 0, lon: 0.0031 };

        const circuit = graph.solveCPP(startPoint, endPoint, manualRoute);

        // No backtrack: just the 5 manual-route points, not a detour doubling
        // back over the node4-node5 edge to "fix" a phantom parity mismatch.
        expect(circuit.length).toBe(5);
        // Ends at the endpoint's own mid-edge click position (existing
        // endpoint-truncation behavior), not doubled back past it to node 5.
        expect(circuit[circuit.length - 1].lon).toBeCloseTo(0.0031, 9);
    });

    test('regression: does not mark a crossing street mandatory when a manual route starts exactly at an intersection', () => {
        // Real-world bug (16th & Maple in Spokane): the route's first two
        // manualRoute points (the raw click's snap, then the first real path
        // node) both landed essentially ON the intersection node itself, not
        // mid-edge. That triggered the "same node" fallback below, which uses
        // findClosestPointOnEdge to guess which edge the waypoints actually lie
        // on — but AT a node with several edges meeting it, that guess is
        // ambiguous and can lock onto a completely different street (here, the
        // crossing street continuing north) instead of the one actually
        // travelled (east), wrongly marking it mandatory and forcing a
        // multi-block out-and-back "matching" detour to cover it.
        const mockData: OverpassResponse = {
            version: 0.6,
            generator: 'test',
            osm3s: { timestamp_osm_base: '', copyright: '' },
            elements: [
                { type: 'node', id: 1, lat: 0.002, lon: 0 },   // N: crossing street, north of the intersection
                { type: 'node', id: 2, lat: 0, lon: 0 },       // A: the intersection (route start)
                { type: 'node', id: 3, lat: 0, lon: 0.001 },   // B
                { type: 'node', id: 4, lat: 0, lon: 0.002 },   // C: route end
                { type: 'way', id: 10, nodes: [1, 2], tags: { highway: 'residential' } }, // crossing street (not travelled)
                { type: 'way', id: 11, nodes: [2, 3, 4], tags: { highway: 'residential' } }, // street actually travelled
            ]
        };
        graph.buildFromOSM(mockData);

        // First two points both land on node A (the intersection) — the raw
        // click's snap and the first real path node are the same coordinate to
        // within a meter, exactly as /api/step produces at a route's start.
        const manualRoute: [number, number][] = [
            [0, 0], [0, 0.0000001], [0.001, 0], [0.002, 0]
        ];

        const circuit = graph.solveCPP(undefined, undefined, manualRoute);

        // The crossing street (node N, lat 0.002/lon 0) must never be visited.
        const visitsCrossingStreet = circuit.some(p => Math.abs(p.lat - 0.002) < 1e-9 && Math.abs(p.lon) < 1e-9);
        expect(visitsCrossingStreet).toBe(false);
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
                { type: 'way', id: 10, nodes: [1, 2], tags: { highway: 'residential' } },
                { type: 'way', id: 11, nodes: [1, 3], tags: { highway: 'residential' } },
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
                { type: 'way', id: 10, nodes: [1, 2, 3], tags: { highway: 'residential' } },
                { type: 'way', id: 11, nodes: [4, 5, 6], tags: { highway: 'residential' } },
                { type: 'way', id: 12, nodes: [1, 4], tags: { highway: 'residential' } },
                { type: 'way', id: 13, nodes: [2, 5], tags: { highway: 'residential' } },
                { type: 'way', id: 14, nodes: [3, 6], tags: { highway: 'residential' } }
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

    describe('applyEndpointSnap', () => {
        // A straight chain, node ids as letters, ~111m apart (0.001 deg).
        // A-B is the "shared" edge: it appears once near the start (index 0-1)
        // and the trail continues on for many more points afterward.
        const A = { lat: 0, lon: 0 };
        const B = { lat: 0, lon: 0.001 };
        const uv = { u: 'A', v: 'B' };

        function longTrailStartingWithAB(tailLength: number) {
            const coords: { lat: number; lon: number }[] = [A, B];
            for (let i = 1; i <= tailLength; i++) coords.push({ lat: 0, lon: 0.001 + i * 0.001 });
            return coords;
        }

        test('regression: does not collapse a long route when the endpoint snaps onto an edge used only near the start', () => {
            // User's reported bug: clicked an endpoint close to the route's own
            // start (a normal way to close a loop) — the snap edge (A-B) was
            // only traversed once, right at the beginning, with 40 more points
            // after it. The old code truncated to 3 points; it must not now.
            const coords = longTrailStartingWithAB(40);
            const endPoint = { lat: 0, lon: 0.0004 }; // mid-edge on A-B, ~44m from A
            const snap = { lat: 0.0, lon: 0.0004, ...uv };

            const result = applyEndpointSnap(coords, endPoint, snap, A, B);

            expect(result.length).toBe(coords.length); // untouched — real end lies elsewhere
        });

        test('still truncates when the snap edge is genuinely at the end of a short route', () => {
            const coords = [A, B]; // A-B is the entire (short) route
            const endPoint = { lat: 0, lon: 0.0004 };
            const snap = { lat: 0.0, lon: 0.0004, ...uv };

            const result = applyEndpointSnap(coords, endPoint, snap, A, B);

            const last = result[result.length - 1];
            expect(last.lat).toBeCloseTo(endPoint.lat, 9);
            expect(last.lon).toBeCloseTo(endPoint.lon, 9);
        });

        test('still truncates when the snap edge is the last edge of a long route', () => {
            const tail = longTrailStartingWithAB(40);
            // Put A-B at the very end instead of the start.
            const coords = [...tail.slice(2), A, B];
            const endPoint = { lat: 0, lon: 0.0004 };
            const snap = { lat: 0.0, lon: 0.0004, ...uv };

            const result = applyEndpointSnap(coords, endPoint, snap, A, B);

            const last = result[result.length - 1];
            expect(last.lat).toBeCloseTo(endPoint.lat, 9);
            expect(last.lon).toBeCloseTo(endPoint.lon, 9);
        });

        test('leaves coords untouched when the click is effectively at an intersection, not mid-edge', () => {
            const coords = longTrailStartingWithAB(10);
            const endPoint = { lat: 0, lon: 0.0000001 }; // right on node A
            const snap = { lat: 0, lon: 0.0000001, ...uv };

            const result = applyEndpointSnap(coords, endPoint, snap, A, B);

            expect(result).toBe(coords);
        });
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
                { type: 'way', id: 10, nodes: [1, 2, 3], tags: { highway: 'residential' } },
                { type: 'way', id: 11, nodes: [4, 5, 6], tags: { highway: 'residential' } },
                { type: 'way', id: 12, nodes: [7, 8, 9], tags: { highway: 'residential' } },
                { type: 'way', id: 13, nodes: [1, 4, 7], tags: { highway: 'residential' } },
                { type: 'way', id: 14, nodes: [2, 5, 8], tags: { highway: 'residential' } },
                { type: 'way', id: 15, nodes: [3, 6, 9], tags: { highway: 'residential' } },
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

    test('mixed mode far-corner target is relative to the point actually entering the area, not the route\'s original first click', () => {
        // Same 3x3 grid as above, entered at the NW corner (node 1) exactly as
        // before — but this time the route has an earlier, distant first waypoint
        // (A) well southeast of the grid before ever reaching the NW entry point.
        // A sits almost equidistant from every corner, but very slightly closer to
        // the NW entry itself than to the true diagonal-opposite SE corner —
        // reproducing a real route shape (start far away, arrive at the area,
        // sweep it, continue on) where using A instead of the real entry point (B)
        // as the "far corner" reference picks the corner closest to entry — i.e.
        // the route loops back near where it came in instead of sweeping away from it.
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
                { type: 'way', id: 10, nodes: [1, 2, 3], tags: { highway: 'residential' } },
                { type: 'way', id: 11, nodes: [4, 5, 6], tags: { highway: 'residential' } },
                { type: 'way', id: 12, nodes: [7, 8, 9], tags: { highway: 'residential' } },
                { type: 'way', id: 13, nodes: [1, 4, 7], tags: { highway: 'residential' } },
                { type: 'way', id: 14, nodes: [2, 5, 8], tags: { highway: 'residential' } },
                { type: 'way', id: 15, nodes: [3, 6, 9], tags: { highway: 'residential' } },
            ]
        };

        graph.buildFromOSM(mockData);

        // Full manualRoute: distant first waypoint (A) -> NW entry corner (B, node 1).
        const manualRoute: [number, number][] = [
            [0.05, -0.05], // A: the route's very first click, far southeast
            [0, 0.002],    // arrives at NW corner (node 1) = B, the real area-entry point
        ];
        // approachRoute mirrors the real client payload: the walked path up to (and
        // including) the last pre-area point. Its last entry is what should be used
        // as the far-corner reference, not manualRoute[0].
        const approachRoute: [number, number][] = [[0.05, -0.05], [0, 0.002]];

        const selectionBoxes = [{ north: 0.002, south: 0, east: 0.002, west: 0 }];

        const result = graph.solveCPP(undefined, undefined, manualRoute, selectionBoxes, undefined, approachRoute);

        // Must end at the SE corner (node 9), the true diagonal-opposite of the NW
        // entry (B) — not near B itself, which is what referencing the distant A
        // would produce here.
        const end = result[result.length - 1];
        expect(end.lat).toBeCloseTo(0, 2);
        expect(end.lon).toBeCloseTo(0.002, 2);

        const distFromEntry = Math.hypot(end.lat - 0.002, end.lon - 0);
        expect(distFromEntry).toBeGreaterThan(0.001);
    });

    test('#64: mixed-mode area endpoint prefers a nearby natural odd-degree node over the literal-nearest even one, avoiding an artificial backtrack', () => {
        // Straight line A-B-C: endpoints A and C are naturally odd-degree (1),
        // interior node B is naturally even-degree (2). The geometric "far corner"
        // of the drawn box is closer to B than to C, but forcing the open path to
        // end exactly at B (even) requires an artificial parity fix — duplicating
        // an edge to create a backtrack — where ending at C (already odd, a
        // natural terminus) needs none.
        const mockData: OverpassResponse = {
            version: 0.6,
            generator: 'test',
            osm3s: { timestamp_osm_base: '', copyright: '' },
            elements: [
                { type: 'node', id: 1, lat: 0, lon: 0 },       // A — approach entry, odd
                { type: 'node', id: 2, lat: 0, lon: 0.001 },   // B — interior, even
                { type: 'node', id: 3, lat: 0, lon: 0.002 },   // C — far end, odd
                { type: 'way', id: 10, nodes: [1, 2, 3], tags: { highway: 'residential' } },
            ]
        };

        graph.buildFromOSM(mockData);

        const manualRoute: [number, number][] = [
            [0, -0.001], // approach start, outside the box
            [0, 0],      // arrives at A
        ];
        // Box's far corner (from A) is B's longitude (0.001), not C's (0.002) —
        // literal-nearest-node would pick B; natural-endpoint search should still
        // find C within the search radius and prefer it.
        const selectionBoxes = [{ north: 0.0001, south: -0.0001, east: 0.0011, west: 0 }];

        const result = graph.solveCPP(undefined, undefined, manualRoute, selectionBoxes);

        // No backtrack: the route should visit each of A, B, C exactly once in order
        // (open path A→B→C), not double back over any edge to fix an artificial
        // parity requirement at B.
        const coords = result.map(p => `${p.lat.toFixed(4)},${p.lon.toFixed(4)}`);
        const visitsOfB = coords.filter(c => c === '0.0000,0.0010').length;
        expect(visitsOfB).toBe(1);

        const end = result[result.length - 1];
        expect(end.lat).toBeCloseTo(0, 4);
        expect(end.lon).toBeCloseTo(0.002, 4); // ends at C, not B
    });

    test('#64 (entry side): mixed-mode area entry also prefers a natural odd-degree node, with the redundant bridge overlap trimmed', () => {
        // Straight line D-E-F: D and F are naturally odd (dead-end-ish, degree 1),
        // interior E is naturally even (degree 2). The manual approach arrives right
        // at E. E is a true cut vertex here (D is only reachable via E), so the rider
        // must still physically pass through E twice no matter which node the CPP
        // treats as its abstract start — that part is unavoidable. What IS fixable is
        // the pure algorithmic artifact: without trimming, the entry bridge and the
        // area path each independently produce a point at D, so D appears twice
        // consecutively (D, D) with zero distance between — a no-op duplicate that
        // trimBridgeOverlap should remove.
        const mockData: OverpassResponse = {
            version: 0.6,
            generator: 'test',
            osm3s: { timestamp_osm_base: '', copyright: '' },
            elements: [
                { type: 'node', id: 1, lat: 0, lon: 0 },       // D — odd
                { type: 'node', id: 2, lat: 0, lon: 0.001 },   // E — interior, even
                { type: 'node', id: 3, lat: 0, lon: 0.002 },   // F — odd
                { type: 'way', id: 20, nodes: [1, 2, 3], tags: { highway: 'residential' } },
            ]
        };

        graph.buildFromOSM(mockData);

        // approachStart is manualRoute[0] — land it exactly at E.
        const manualRoute: [number, number][] = [[0.001, 0], [0.001, -0.001]];
        const selectionBoxes = [{ north: 0.0001, south: -0.0001, east: 0.002, west: 0 }];

        const result = graph.solveCPP(undefined, undefined, manualRoute, selectionBoxes);

        // No two consecutive points should be identical — that's always a pure
        // no-op artifact, never a legitimate part of a route.
        for (let i = 1; i < result.length; i++) {
            const same = result[i].lat === result[i - 1].lat && result[i].lon === result[i - 1].lon;
            expect(same).toBe(false);
        }
    });

    test('#64 (exit side): mixed-mode area targets a real subsequent waypoint instead of an arbitrary geometric corner', () => {
        // Grid:  A(0,0) - B(0,0.001) - C(0,0.002)
        //         |            |            |
        //        D(0.001,0)-E(0.001,0.001)-F(0.001,0.002)
        // B and E are the only natural odd-degree (3) nodes. Approach enters near A
        // (top-left). The real 2nd waypoint (endPoint) sits right next to B — the
        // OPPOSITE side of the grid from the geometric far corner (near F/C), which
        // the old code would've blindly targeted regardless of where the route
        // actually needs to go next.
        const mockData: OverpassResponse = {
            version: 0.6,
            generator: 'test',
            osm3s: { timestamp_osm_base: '', copyright: '' },
            elements: [
                { type: 'node', id: 1, lat: 0, lon: 0 },        // A
                { type: 'node', id: 2, lat: 0, lon: 0.001 },    // B — odd
                { type: 'node', id: 3, lat: 0, lon: 0.002 },    // C
                { type: 'node', id: 4, lat: 0.001, lon: 0 },     // D
                { type: 'node', id: 5, lat: 0.001, lon: 0.001 }, // E — odd
                { type: 'node', id: 6, lat: 0.001, lon: 0.002 }, // F
                { type: 'way', id: 100, nodes: [1, 2, 3], tags: { highway: 'residential' } },
                { type: 'way', id: 101, nodes: [4, 5, 6], tags: { highway: 'residential' } },
                { type: 'way', id: 102, nodes: [1, 4], tags: { highway: 'residential' } },
                { type: 'way', id: 103, nodes: [2, 5], tags: { highway: 'residential' } },
                { type: 'way', id: 104, nodes: [3, 6], tags: { highway: 'residential' } },
            ]
        };

        graph.buildFromOSM(mockData);

        const manualRoute: [number, number][] = [[-0.001, 0], [0, 0]]; // approach arrives at A
        const selectionBoxes = [{ north: 0.0011, south: -0.0001, east: 0.0021, west: -0.0001 }];
        const realExitTarget = { lat: 0.0001, lon: 0.001 }; // right next to B

        const result = graph.solveCPP(undefined, realExitTarget, manualRoute, selectionBoxes);

        // The route should end near the real exit target (B), not the geometric far
        // corner on the opposite side of the grid (near C/F).
        const end = result[result.length - 1];
        const distToB = Math.hypot(end.lat - 0, end.lon - 0.001);
        const distToFarCorner = Math.hypot(end.lat - 0.0011, end.lon - 0.0021);
        expect(distToB).toBeLessThan(distToFarCorner);
    });

    test('exit bridge does not detour through a farther edge-endpoint candidate when the area already ends at the nearer one', () => {
        // Same grid as the #64 exit-side test. B is the natural odd-degree node the
        // area's own trail already ends at. The post-area target sits essentially AT
        // B (on the B-E edge, a hair away from B) — so the exit bridge should need
        // ~0 extra distance, not detour out to E (111m away) and back because E
        // happened to be tried as a pathfinding candidate before recognizing the
        // area's own endpoint was already one of the edge's two nodes.
        const mockData: OverpassResponse = {
            version: 0.6,
            generator: 'test',
            osm3s: { timestamp_osm_base: '', copyright: '' },
            elements: [
                { type: 'node', id: 1, lat: 0, lon: 0 },        // A
                { type: 'node', id: 2, lat: 0, lon: 0.001 },    // B — odd
                { type: 'node', id: 3, lat: 0, lon: 0.002 },    // C
                { type: 'node', id: 4, lat: 0.001, lon: 0 },     // D
                { type: 'node', id: 5, lat: 0.001, lon: 0.001 }, // E — odd
                { type: 'node', id: 6, lat: 0.001, lon: 0.002 }, // F
                { type: 'way', id: 100, nodes: [1, 2, 3], tags: { highway: 'residential' } },
                { type: 'way', id: 101, nodes: [4, 5, 6], tags: { highway: 'residential' } },
                { type: 'way', id: 102, nodes: [1, 4], tags: { highway: 'residential' } },
                { type: 'way', id: 103, nodes: [2, 5], tags: { highway: 'residential' } },
                { type: 'way', id: 104, nodes: [3, 6], tags: { highway: 'residential' } },
            ]
        };

        graph.buildFromOSM(mockData);

        const manualRoute: [number, number][] = [[-0.001, 0], [0, 0]];
        const selectionBoxes = [{ north: 0.0011, south: -0.0001, east: 0.0021, west: -0.0001 }];
        const realExitTarget = { lat: 0.00001, lon: 0.001 }; // essentially at B, on the B-E edge

        const result = graph.solveCPP(undefined, realExitTarget, manualRoute, selectionBoxes);

        // B legitimately appears earlier too — the CPP's own T-join matching duplicates
        // the B-E edge to fix parity (B and E are the only odd nodes), so the area's
        // required coverage trail itself passes through B before ever reaching the
        // exit bridge. That's real, necessary mileage, not the bug. The bug under test
        // is specifically what happens AFTER the area trail's own last point — so find
        // the LAST B (the actual area-end / exit-bridge start), not the first.
        const M_PER_DEG = 111320;
        const dist = (a: { lat: number; lon: number }, b: { lat: number; lon: number }) => {
            const dLat = (a.lat - b.lat) * M_PER_DEG;
            const dLon = (a.lon - b.lon) * M_PER_DEG;
            return Math.hypot(dLat, dLon);
        };
        let bIdx = -1;
        for (let i = result.length - 1; i >= 0; i--) {
            if (Math.abs(result[i].lat - 0) < 1e-6 && Math.abs(result[i].lon - 0.001) < 1e-6) { bIdx = i; break; }
        }
        expect(bIdx).toBeGreaterThanOrEqual(0);
        let tailDist = 0;
        for (let i = bIdx; i < result.length - 1; i++) {
            tailDist += dist(result[i], result[i + 1]);
        }
        expect(tailDist).toBeLessThan(50);
    });

    describe('trimBridgeOverlap', () => {
        const p = (lat: number, lon: number) => ({ lat, lon });

        it('trims a bridge that exactly retraces the path\'s leading edge', () => {
            // Bridge arrives at D via E; path immediately leaves D back through E.
            const bridge = [p(0, 0.001), p(0, 0)]; // E -> D
            const path = [p(0, 0), p(0, 0.001), p(0, 0.002)]; // D -> E -> F
            const result = trimBridgeOverlap(bridge, path);
            expect(result).toEqual([p(0, 0.001)]); // just E; D dropped as redundant with path[0]
        });

        it('does not trim when the bridge does not overlap the path', () => {
            const bridge = [p(1, 1), p(0, 0)];
            const path = [p(0, 0), p(0, 0.001), p(0, 0.002)];
            const result = trimBridgeOverlap(bridge, path);
            expect(result).toEqual(bridge);
        });

        it('leaves short bridges/paths untouched', () => {
            expect(trimBridgeOverlap([], [])).toEqual([]);
            expect(trimBridgeOverlap([p(0, 0)], [p(0, 0), p(0, 1)])).toEqual([p(0, 0)]);
        });
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
                { type: 'way', id: 10, nodes: [1, 2, 3, 4, 1], tags: { highway: 'residential' } }
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

    test('regression: avoidGravel marks an untagged park path/footway as avoided, not just untagged track', () => {
        // Real-world bug: a lasso drawn near a small park whose paths are tagged
        // highway=path/footway with no surface tag slipped through avoidGravel
        // entirely (only highway=track was covered for the no-surface-tag case),
        // so those paths became the ONLY unavoided, unridden "required" edges for
        // the area -- ignoring real streets nearby that the user actually wanted.
        const mockData: OverpassResponse = {
            version: 0.6,
            generator: 'test',
            osm3s: { timestamp_osm_base: '', copyright: '' },
            elements: [
                { type: 'node', id: 1, lat: 0, lon: 0 },
                { type: 'node', id: 2, lat: 0, lon: 0.001 },
                { type: 'node', id: 3, lat: 0, lon: 0.002 },
                { type: 'node', id: 4, lat: 0, lon: 0.003 },
                { type: 'way', id: 500, nodes: [1, 2], tags: { highway: 'path' } },
                { type: 'way', id: 501, nodes: [2, 3], tags: { highway: 'footway' } },
                { type: 'way', id: 502, nodes: [3, 4], tags: { highway: 'track' } },
            ]
        };

        const graph = new StreetGraph();
        graph.buildFromOSM(mockData, null, { avoidGravel: true });

        expect(graph.graph.getLink('1', '2')!.data.isAvoided).toBe(true);
        expect(graph.graph.getLink('2', '3')!.data.isAvoided).toBe(true);
        expect(graph.graph.getLink('3', '4')!.data.isAvoided).toBe(true);
    });

    test('trunk penalty is 12x with avoidHighways on, 2x with it off', () => {
        const mockData: OverpassResponse = {
            version: 0.6,
            generator: 'test',
            osm3s: { timestamp_osm_base: '', copyright: '' },
            elements: [
                { type: 'node', id: 1, lat: 0, lon: 0 },
                { type: 'node', id: 2, lat: 0, lon: 0.01 },
                { type: 'way', id: 300, nodes: [1, 2], tags: { highway: 'trunk' } }
            ]
        };

        const avoiding = new StreetGraph();
        avoiding.buildFromOSM(mockData, null, { avoidHighways: true });
        const baseDist = avoiding.graph.getLink('1', '2')!.data.weight / 12;

        const notAvoiding = new StreetGraph();
        notAvoiding.buildFromOSM(mockData, null, { avoidHighways: false });

        expect(avoiding.graph.getLink('1', '2')!.data.weight).toBeCloseTo(baseDist * 12, 3);
        expect(notAvoiding.graph.getLink('1', '2')!.data.weight).toBeCloseTo(baseDist * 2, 3);
    });

    test('trunk is still traversable (not hard-blocked) when routing directly between two points on it', () => {
        // Trunk road 1-2-3, with a much longer residential detour 1-4-5-3 as the "alternative".
        const mockData: OverpassResponse = {
            version: 0.6,
            generator: 'test',
            osm3s: { timestamp_osm_base: '', copyright: '' },
            elements: [
                { type: 'node', id: 1, lat: 0, lon: 0 },
                { type: 'node', id: 2, lat: 0, lon: 0.001 },
                { type: 'node', id: 3, lat: 0, lon: 0.002 },
                { type: 'node', id: 4, lat: 0.05, lon: 0 },
                { type: 'node', id: 5, lat: 0.05, lon: 0.002 },
                { type: 'way', id: 400, nodes: [1, 2, 3], tags: { highway: 'trunk' } },
                { type: 'way', id: 401, nodes: [1, 4, 5, 3], tags: { highway: 'residential' } }
            ]
        };

        const graph = new StreetGraph();
        graph.buildFromOSM(mockData, null, { avoidHighways: false });
        const result = graph.findPath('1', '3');

        expect(result.length).toBeGreaterThan(0);
        const usedTrunk = result.some(p => graph.graph.getLink(p.id, p.idNext)?.data.highway === 'trunk');
        expect(usedTrunk).toBe(true);
    });

    test('ramp (motorway_link/trunk_link) penalty is 30x with avoidHighways on, 5x with it off', () => {
        const mockData: OverpassResponse = {
            version: 0.6,
            generator: 'test',
            osm3s: { timestamp_osm_base: '', copyright: '' },
            elements: [
                { type: 'node', id: 1, lat: 0, lon: 0 },
                { type: 'node', id: 2, lat: 0, lon: 0.01 },
                { type: 'way', id: 500, nodes: [1, 2], tags: { highway: 'trunk_link' } }
            ]
        };

        const avoiding = new StreetGraph();
        avoiding.buildFromOSM(mockData, null, { avoidHighways: true });
        const baseDist = avoiding.graph.getLink('1', '2')!.data.weight / 30;

        const notAvoiding = new StreetGraph();
        notAvoiding.buildFromOSM(mockData, null, { avoidHighways: false });

        expect(avoiding.graph.getLink('1', '2')!.data.weight).toBeCloseTo(baseDist * 30, 3);
        expect(notAvoiding.graph.getLink('1', '2')!.data.weight).toBeCloseTo(baseDist * 5, 3);
    });

    test('a route can use an on-ramp to actually reach a trunk road when avoidHighways is off', () => {
        // Local road 1-2, ramp 2-3 (trunk_link) onto trunk 3-4, vs. a much longer detour 1-5-6-4.
        const mockData: OverpassResponse = {
            version: 0.6,
            generator: 'test',
            osm3s: { timestamp_osm_base: '', copyright: '' },
            elements: [
                { type: 'node', id: 1, lat: 0, lon: 0 },
                { type: 'node', id: 2, lat: 0, lon: 0.001 },
                { type: 'node', id: 3, lat: 0, lon: 0.002 },
                { type: 'node', id: 4, lat: 0, lon: 0.003 },
                { type: 'node', id: 5, lat: 0.05, lon: 0 },
                { type: 'node', id: 6, lat: 0.05, lon: 0.003 },
                { type: 'way', id: 600, nodes: [1, 2], tags: { highway: 'residential' } },
                { type: 'way', id: 601, nodes: [2, 3], tags: { highway: 'trunk_link' } },
                { type: 'way', id: 602, nodes: [3, 4], tags: { highway: 'trunk' } },
                { type: 'way', id: 603, nodes: [1, 5, 6, 4], tags: { highway: 'residential' } }
            ]
        };

        const graph = new StreetGraph();
        graph.buildFromOSM(mockData, null, { avoidHighways: false });
        const result = graph.findPath('1', '4');

        expect(result.length).toBeGreaterThan(0);
        const usedRamp = result.some(p => graph.graph.getLink(p.id, p.idNext)?.data.highway === 'trunk_link');
        expect(usedRamp).toBe(true);
    });

    describe('ridden-road matching (checkIfRidden)', () => {
        // Real-world bug: a lasso covering an area the user had actually ridden almost
        // entirely still generated a route covering nearly every street, because
        // isRidden was failing to match far more often than it should. Two compounding
        // causes, both covered below: (1) the old-vs-new-node endpoint exclusion was a
        // *percentage* of a short edge's own length in a way that interacted badly with
        // real GPS point spacing, and (2) the 25m match threshold was tighter than
        // typical real-world GPS accuracy (urban tree/building cover), confirmed via a
        // live diagnostic showing genuinely-ridden edges whose closest matching point
        // was routinely 26-52m away.

        test('a dense GPS trace right along a short (~50m) edge marks it ridden', () => {
            const graph = new StreetGraph();
            const mockData: OverpassResponse = {
                version: 0.6, generator: 'test', osm3s: { timestamp_osm_base: '', copyright: '' },
                elements: [
                    { type: 'node', id: 1, lat: 47.65, lon: -117.42 },
                    { type: 'node', id: 2, lat: 47.65, lon: -117.4193 }, // ~54m east at this latitude
                    { type: 'way', id: 100, nodes: [1, 2], tags: { highway: 'residential' } },
                ]
            };
            const riddenRoads: [number, number][][] = [[
                [47.65, -117.4204], [47.65, -117.4202], [47.65, -117.4200],
                [47.65, -117.4198], [47.65, -117.4196], [47.65, -117.4194],
            ]];
            graph.buildFromOSM(mockData, riddenRoads);
            expect(graph.graph.getLink('1', '2')!.data.isRidden).toBe(true);
        });

        test('regression: matches a genuinely-ridden edge whose GPS trace drifts ~40m off the road (realistic urban GPS noise)', () => {
            const graph = new StreetGraph();
            // Edge running east-west along lat 47.65, ~110m long.
            const mockData: OverpassResponse = {
                version: 0.6, generator: 'test', osm3s: { timestamp_osm_base: '', copyright: '' },
                elements: [
                    { type: 'node', id: 1, lat: 47.65, lon: -117.42 },
                    { type: 'node', id: 2, lat: 47.65, lon: -117.4187 },
                    { type: 'way', id: 200, nodes: [1, 2], tags: { highway: 'residential' } },
                ]
            };
            // GPS trace parallel to the road but offset ~0.00036 deg north (~40m at this
            // latitude) -- realistic drift from tree/building cover, not a parallel street.
            const riddenRoads: [number, number][][] = [[
                [47.6504, -117.4197], [47.6504, -117.4195], [47.6504, -117.4193],
                [47.6504, -117.4191], [47.6504, -117.4189],
            ]];
            graph.buildFromOSM(mockData, riddenRoads);
            expect(graph.graph.getLink('1', '2')!.data.isRidden).toBe(true);
        });

        test('does not mark an edge ridden from a trace on a genuinely different, parallel street', () => {
            const graph = new StreetGraph();
            const mockData: OverpassResponse = {
                version: 0.6, generator: 'test', osm3s: { timestamp_osm_base: '', copyright: '' },
                elements: [
                    { type: 'node', id: 1, lat: 47.65, lon: -117.42 },
                    { type: 'node', id: 2, lat: 47.65, lon: -117.4187 },
                    { type: 'way', id: 300, nodes: [1, 2], tags: { highway: 'residential' } },
                ]
            };
            // A parallel street ~100m north -- well beyond real GPS drift, should not match.
            const riddenRoads: [number, number][][] = [[
                [47.6509, -117.4197], [47.6509, -117.4193], [47.6509, -117.4189],
            ]];
            graph.buildFromOSM(mockData, riddenRoads);
            expect(graph.graph.getLink('1', '2')!.data.isRidden).toBe(false);
        });

        test('does not credit a street from a GPS point only near the shared intersection with a different street', () => {
            // Y-junction: node 1 is the shared intersection. Way A (1-2) is genuinely
            // ridden; way B (1-3) is a different street that just happens to share that
            // intersection -- a GPS point sitting right at node 1 must not credit B too.
            const graph = new StreetGraph();
            const mockData: OverpassResponse = {
                version: 0.6, generator: 'test', osm3s: { timestamp_osm_base: '', copyright: '' },
                elements: [
                    { type: 'node', id: 1, lat: 47.65, lon: -117.42 },
                    { type: 'node', id: 2, lat: 47.65, lon: -117.4187 },   // A: east
                    { type: 'node', id: 3, lat: 47.6509, lon: -117.42 },   // B: north
                    { type: 'way', id: 400, nodes: [1, 2], tags: { highway: 'residential' } },
                    { type: 'way', id: 401, nodes: [1, 3], tags: { highway: 'residential' } },
                ]
            };
            const riddenRoads: [number, number][][] = [[
                [47.65, -117.4198], [47.65, -117.4195], [47.65, -117.4193], // partway along A, toward node 2
            ]];
            graph.buildFromOSM(mockData, riddenRoads);
            expect(graph.graph.getLink('1', '2')!.data.isRidden).toBe(true);
            expect(graph.graph.getLink('1', '3')!.data.isRidden).toBe(false);
        });

        // Real-world bug: a street the rider had clearly ridden straight through
        // (South Lamonte St, Spokane) had a ~11m unridden sliver mid-block, split
        // across two short OSM-graph edges, sandwiched between two long ridden
        // edges on either side -- classic sparse/decimated GPS trace missing a
        // couple of the finely-diced graph edges OSM has near intersections. The
        // CPP solver treated that sliver as a genuine isolated required pocket,
        // reachable only by an out-and-back through the already-ridden street on
        // both sides. lib/riddenRoads.ts's map-overlay matching already bridges
        // exactly this class of short (<=20m) gap; buildFromOSM now mirrors it so
        // routing and the overlay agree on what's ridden.
        test('bridges a short (<=20m) unridden gap fully sandwiched between two ridden edges on the same way', () => {
            const graph = new StreetGraph();
            // Four collinear nodes along one way: 1-2 ridden (100m), 2-3 the short
            // unridden gap (10m), 3-4 ridden (100m). Only the GPS trace for 1-2 and
            // 3-4 is provided -- 2-3 has no matching points at all.
            const mockData: OverpassResponse = {
                version: 0.6, generator: 'test', osm3s: { timestamp_osm_base: '', copyright: '' },
                elements: [
                    { type: 'node', id: 1, lat: 47.65, lon: -117.42 },
                    { type: 'node', id: 2, lat: 47.65, lon: -117.4187 },   // ~100m east of 1
                    { type: 'node', id: 3, lat: 47.65, lon: -117.41857 }, // ~10m east of 2
                    { type: 'node', id: 4, lat: 47.65, lon: -117.4173 },  // ~100m east of 3
                    { type: 'way', id: 500, nodes: [1, 2, 3, 4], tags: { highway: 'residential' } },
                ]
            };
            // Two separate polylines (not one continuous track) -- buildRiddenIndex
            // interpolates between consecutive points *within* a polyline at ~12m
            // stride, so a single combined array would draw a fake interpolated
            // line straight across the gap and defeat the point of this test.
            const riddenRoads: [number, number][][] = [
                [[47.65, -117.42], [47.65, -117.4195], [47.65, -117.4190], [47.65, -117.4187]], // covers 1-2
                [[47.65, -117.41857], [47.65, -117.4180], [47.65, -117.4175], [47.65, -117.4173]], // covers 3-4
            ];
            graph.buildFromOSM(mockData, riddenRoads);
            expect(graph.graph.getLink('1', '2')!.data.isRidden).toBe(true);
            expect(graph.graph.getLink('2', '3')!.data.isRidden).toBe(true); // bridged
            expect(graph.graph.getLink('3', '4')!.data.isRidden).toBe(true);
        });

        test('does NOT bridge a gap open at the start/end of the way (not sandwiched, so not bridged)', () => {
            const graph = new StreetGraph();
            const mockData: OverpassResponse = {
                version: 0.6, generator: 'test', osm3s: { timestamp_osm_base: '', copyright: '' },
                elements: [
                    { type: 'node', id: 1, lat: 47.65, lon: -117.42 },
                    { type: 'node', id: 2, lat: 47.65, lon: -117.41988 }, // ~10m east of 1 -- unridden
                    { type: 'node', id: 3, lat: 47.65, lon: -117.4187 },  // ~100m further -- ridden
                    { type: 'way', id: 501, nodes: [1, 2, 3], tags: { highway: 'residential' } },
                ]
            };
            const riddenRoads: [number, number][][] = [[
                [47.65, -117.41988], [47.65, -117.4193], [47.65, -117.4187], // covers 2-3's interior
            ]];
            graph.buildFromOSM(mockData, riddenRoads);
            expect(graph.graph.getLink('1', '2')!.data.isRidden).toBe(false); // real gap, not bridged
            expect(graph.graph.getLink('2', '3')!.data.isRidden).toBe(true);
        });

        test('does NOT bridge a gap longer than 20m even when sandwiched by ridden edges', () => {
            const graph = new StreetGraph();
            const mockData: OverpassResponse = {
                version: 0.6, generator: 'test', osm3s: { timestamp_osm_base: '', copyright: '' },
                elements: [
                    { type: 'node', id: 1, lat: 47.65, lon: -117.42 },
                    { type: 'node', id: 2, lat: 47.65, lon: -117.4187 },  // ridden (~100m)
                    { type: 'node', id: 3, lat: 47.65, lon: -117.4157 },  // ~250m further -- genuinely unridden
                    { type: 'node', id: 4, lat: 47.65, lon: -117.4144 },  // ridden (~100m)
                    { type: 'way', id: 502, nodes: [1, 2, 3, 4], tags: { highway: 'residential' } },
                ]
            };
            // Two separate polylines (not one continuous track) -- buildRiddenIndex
            // interpolates between consecutive points *within* a polyline at ~12m
            // stride, so a single combined array would draw a fake interpolated
            // line straight across the gap and defeat the point of this test.
            const riddenRoads: [number, number][][] = [
                [[47.65, -117.42], [47.65, -117.4195], [47.65, -117.4190], [47.65, -117.4187]],
                [[47.65, -117.4144], [47.65, -117.4148], [47.65, -117.4150]], // stays >50m clear of node 3
            ];
            graph.buildFromOSM(mockData, riddenRoads);
            expect(graph.graph.getLink('1', '2')!.data.isRidden).toBe(true);
            expect(graph.graph.getLink('2', '3')!.data.isRidden).toBe(false); // too long to bridge
            expect(graph.graph.getLink('3', '4')!.data.isRidden).toBe(true);
        });
    });

    describe('gated-community / HOA streets (access=private)', () => {
        test('is still added as a graph edge (so ridden activity there still shows), but heavily avoided for routing', () => {
            const graph = new StreetGraph();
            const plainData: OverpassResponse = {
                version: 0.6, generator: 'test', osm3s: { timestamp_osm_base: '', copyright: '' },
                elements: [
                    { type: 'node', id: 1, lat: 47.65, lon: -117.42 },
                    { type: 'node', id: 2, lat: 47.65, lon: -117.4193 },
                    { type: 'way', id: 700, nodes: [1, 2], tags: { highway: 'residential' } },
                ]
            };
            const plainGraph = new StreetGraph();
            plainGraph.buildFromOSM(plainData, null);
            const plainWeight = plainGraph.graph.getLink('1', '2')!.data.weight;

            const privateData: OverpassResponse = {
                version: 0.6, generator: 'test', osm3s: { timestamp_osm_base: '', copyright: '' },
                elements: [
                    { type: 'node', id: 1, lat: 47.65, lon: -117.42 },
                    { type: 'node', id: 2, lat: 47.65, lon: -117.4193 },
                    { type: 'way', id: 701, nodes: [1, 2], tags: { highway: 'residential', access: 'private' } },
                ]
            };
            graph.buildFromOSM(privateData, null);
            const link = graph.graph.getLink('1', '2')!;
            expect(link).toBeDefined();
            expect(link.data.isAvoided).toBe(true);
            expect(link.data.weight).toBeCloseTo(plainWeight * 50, 5);
        });

        test('a genuinely closed road (access=no) is filtered upstream and never reaches buildFromOSM as routable', () => {
            // access=no exclusion happens in the Overpass query/XML parser (lib/overpass.ts),
            // not here -- isRoutableHighway has no access-tag awareness, so this documents the
            // boundary: buildFromOSM alone can't tell access=no from a normal way.
            expect(isRoutableHighway('residential', { access: 'no' })).toBe(true);
        });

        test('still marks a ridden access=private edge isRidden, independent of the routing avoidance', () => {
            const graph = new StreetGraph();
            const mockData: OverpassResponse = {
                version: 0.6, generator: 'test', osm3s: { timestamp_osm_base: '', copyright: '' },
                elements: [
                    { type: 'node', id: 1, lat: 47.65, lon: -117.42 },
                    { type: 'node', id: 2, lat: 47.65, lon: -117.4193 },
                    { type: 'way', id: 702, nodes: [1, 2], tags: { highway: 'residential', access: 'private' } },
                ]
            };
            const riddenRoads: [number, number][][] = [[
                [47.65, -117.4204], [47.65, -117.4202], [47.65, -117.4200],
                [47.65, -117.4198], [47.65, -117.4196], [47.65, -117.4194],
            ]];
            graph.buildFromOSM(mockData, riddenRoads);
            const link = graph.graph.getLink('1', '2')!;
            expect(link.data.isRidden).toBe(true);
            expect(link.data.isAvoided).toBe(true);
        });
    });

    describe('user-marked avoided roads (issue #45)', () => {
        test('marks a matching edge isUserAvoided and heavily penalizes its weight, without hard-excluding it', () => {
            const graph = new StreetGraph();
            const mockData: OverpassResponse = {
                version: 0.6, generator: 'test', osm3s: { timestamp_osm_base: '', copyright: '' },
                elements: [
                    { type: 'node', id: 1, lat: 47.65, lon: -117.42 },
                    { type: 'node', id: 2, lat: 47.65, lon: -117.4193 }, // ~54m east at this latitude
                    { type: 'way', id: 500, nodes: [1, 2], tags: { highway: 'residential' } },
                ]
            };
            const avoidedRoads: [number, number][][] = [[
                [47.65, -117.4204], [47.65, -117.4202], [47.65, -117.4200],
                [47.65, -117.4198], [47.65, -117.4196], [47.65, -117.4194],
            ]];
            const plainGraph = new StreetGraph();
            plainGraph.buildFromOSM(mockData, null);
            const plainWeight = plainGraph.graph.getLink('1', '2')!.data.weight;

            graph.buildFromOSM(mockData, null, { avoidedRoads });
            const link = graph.graph.getLink('1', '2')!;
            expect(link.data.isUserAvoided).toBe(true);
            expect(link.data.isAvoided).toBe(true);
            expect(link.data.weight).toBeCloseTo(plainWeight * 100, 5);
        });

        test('leaves unrelated edges untouched when avoidedRoads is set', () => {
            const graph = new StreetGraph();
            const mockData: OverpassResponse = {
                version: 0.6, generator: 'test', osm3s: { timestamp_osm_base: '', copyright: '' },
                elements: [
                    { type: 'node', id: 1, lat: 47.65, lon: -117.42 },
                    { type: 'node', id: 2, lat: 47.65, lon: -117.4187 },
                    { type: 'way', id: 600, nodes: [1, 2], tags: { highway: 'residential' } },
                ]
            };
            // A parallel street ~100m north -- well beyond match threshold.
            const avoidedRoads: [number, number][][] = [[
                [47.6509, -117.4197], [47.6509, -117.4193], [47.6509, -117.4189],
            ]];
            graph.buildFromOSM(mockData, null, { avoidedRoads });
            const link = graph.graph.getLink('1', '2')!;
            expect(link.data.isUserAvoided).toBe(false);
            expect(link.data.isAvoided).toBe(false);
        });
    });
});

describe('Point-in-Polygon Functions', () => {
    describe('getPolygonBounds', () => {
        test('calculates bounds for a simple square', () => {
            const polygon: [number, number][] = [
                [0, 0],
                [1, 0],
                [1, 1],
                [0, 1]
            ];
            const bounds = getPolygonBounds(polygon);
            expect(bounds.minLat).toBe(0);
            expect(bounds.maxLat).toBe(1);
            expect(bounds.minLon).toBe(0);
            expect(bounds.maxLon).toBe(1);
        });

        test('calculates bounds for an irregular polygon', () => {
            const polygon: [number, number][] = [
                [0.5, 1.5],
                [2.3, 0.8],
                [1.2, 3.4],
                [-0.5, 2.1]
            ];
            const bounds = getPolygonBounds(polygon);
            expect(bounds.minLat).toBe(-0.5);
            expect(bounds.maxLat).toBe(2.3);
            expect(bounds.minLon).toBe(0.8);
            expect(bounds.maxLon).toBe(3.4);
        });

        test('handles triangle', () => {
            const polygon: [number, number][] = [
                [0, 0],
                [1, 0],
                [0.5, 1]
            ];
            const bounds = getPolygonBounds(polygon);
            expect(bounds.minLat).toBe(0);
            expect(bounds.maxLat).toBe(1);
            expect(bounds.minLon).toBe(0);
            expect(bounds.maxLon).toBe(1);
        });
    });

    describe('pointInPolygon', () => {
        test('point inside square', () => {
            const polygon: [number, number][] = [
                [0, 0],
                [2, 0],
                [2, 2],
                [0, 2]
            ];
            expect(pointInPolygon([1, 1], polygon)).toBe(true);
        });

        test('point outside square', () => {
            const polygon: [number, number][] = [
                [0, 0],
                [2, 0],
                [2, 2],
                [0, 2]
            ];
            expect(pointInPolygon([3, 3], polygon)).toBe(false);
        });

        test('point outside bounding box (quick rejection)', () => {
            const polygon: [number, number][] = [
                [1, 1],
                [2, 1],
                [2, 2],
                [1, 2]
            ];
            expect(pointInPolygon([5, 5], polygon)).toBe(false);
            expect(pointInPolygon([-1, -1], polygon)).toBe(false);
        });

        test('point inside triangle', () => {
            const polygon: [number, number][] = [
                [0, 0],
                [4, 0],
                [2, 4]
            ];
            expect(pointInPolygon([2, 1], polygon)).toBe(true);
            expect(pointInPolygon([2, 2], polygon)).toBe(true);
        });

        test('point outside triangle', () => {
            const polygon: [number, number][] = [
                [0, 0],
                [4, 0],
                [2, 4]
            ];
            expect(pointInPolygon([0, 3], polygon)).toBe(false);
            expect(pointInPolygon([4, 2], polygon)).toBe(false);
        });

        test('point at polygon vertex', () => {
            const polygon: [number, number][] = [
                [0, 0],
                [2, 0],
                [2, 2],
                [0, 2]
            ];
            // Ray casting on vertices is implementation-dependent
            // First vertex is typically inside, others may not be
            expect(pointInPolygon([0, 0], polygon)).toBe(true);
        });

        test('point on polygon edge', () => {
            const polygon: [number, number][] = [
                [0, 0],
                [2, 0],
                [2, 2],
                [0, 2]
            ];
            expect(pointInPolygon([1, 0], polygon)).toBe(true);
            expect(pointInPolygon([0, 1], polygon)).toBe(true);
        });

        test('concave polygon: point inside indentation', () => {
            // L-shaped polygon
            const polygon: [number, number][] = [
                [0, 0],
                [3, 0],
                [3, 2],
                [2, 2],
                [2, 1],
                [0, 1]
            ];
            expect(pointInPolygon([2.5, 0.5], polygon)).toBe(true);
            expect(pointInPolygon([0.5, 0.5], polygon)).toBe(true);
        });

        test('concave polygon: point in notch (outside)', () => {
            // L-shaped polygon with notch
            const polygon: [number, number][] = [
                [0, 0],
                [3, 0],
                [3, 2],
                [2, 2],
                [2, 1],
                [0, 1]
            ];
            // Point clearly outside the polygon bounds
            expect(pointInPolygon([4, 1.5], polygon)).toBe(false);
        });

        test('narrow polygon (slit)', () => {
            const polygon: [number, number][] = [
                [0, 0],
                [10, 0],
                [10, 0.1],
                [0, 0.1]
            ];
            expect(pointInPolygon([5, 0.05], polygon)).toBe(true);
            expect(pointInPolygon([5, 0.2], polygon)).toBe(false);
        });

        test('pentagon', () => {
            const polygon: [number, number][] = [
                [2, 0],      // bottom
                [4, 1],      // bottom right
                [3, 3],      // top right
                [1, 3],      // top left
                [0, 1]       // bottom left
            ];
            expect(pointInPolygon([2, 1.5], polygon)).toBe(true);
            expect(pointInPolygon([2, 4], polygon)).toBe(false);
        });

        test('polygon with collinear points', () => {
            // Square with extra collinear point on edge
            const polygon: [number, number][] = [
                [0, 0],
                [1, 0],
                [2, 0],
                [2, 2],
                [0, 2]
            ];
            expect(pointInPolygon([1.5, 1], polygon)).toBe(true);
            expect(pointInPolygon([1, 0], polygon)).toBe(true);
        });

        test('ray casting with horizontal edge', () => {
            // Test that horizontal edges are handled correctly in ray casting
            const polygon: [number, number][] = [
                [0, 0],
                [2, 0],
                [2, 2],
                [0, 2]
            ];
            expect(pointInPolygon([1, 1], polygon)).toBe(true);
            expect(pointInPolygon([3, 1], polygon)).toBe(false);
        });
    });

    describe('pointNearOrInPolygon', () => {
        // ~0.0001 deg is roughly 11m at these latitudes — small enough to test
        // "just outside the line" without leaving the polygon's bounding box.
        const square: [number, number][] = [
            [47.0, -117.0],
            [47.001, -117.0],
            [47.001, -116.999],
            [47.0, -116.999],
        ];

        test('a point already inside is near-or-in regardless of buffer', () => {
            expect(pointNearOrInPolygon([47.0005, -116.9995], square, 0)).toBe(true);
        });

        test('a point just outside the boundary is excluded with zero buffer (the old lasso behavior)', () => {
            const justOutside: [number, number] = [47.0, -116.9995];
            const nudged: [number, number] = [justOutside[0] - 0.0001, justOutside[1]];
            expect(pointInPolygon(nudged, square)).toBe(false);
            expect(pointNearOrInPolygon(nudged, square, 0)).toBe(false);
        });

        test('a point just outside the boundary is included once the buffer covers the gap', () => {
            const nudged: [number, number] = [47.0 - 0.0001, -116.9995]; // ~11m south of the edge
            expect(pointNearOrInPolygon(nudged, square, 15)).toBe(true);
        });

        test('a point far outside stays excluded even with a generous buffer', () => {
            expect(pointNearOrInPolygon([48.0, -116.9995], square, 100)).toBe(false);
        });
    });

    describe('pointInAnyPolygon', () => {
        test('point in first polygon', () => {
            const polygons: [number, number][][] = [
                [[0, 0], [2, 0], [2, 2], [0, 2]],
                [[5, 5], [7, 5], [7, 7], [5, 7]]
            ];
            expect(pointInAnyPolygon([1, 1], polygons)).toBe(true);
        });

        test('point in second polygon', () => {
            const polygons: [number, number][][] = [
                [[0, 0], [2, 0], [2, 2], [0, 2]],
                [[5, 5], [7, 5], [7, 7], [5, 7]]
            ];
            expect(pointInAnyPolygon([6, 6], polygons)).toBe(true);
        });

        test('point in neither polygon', () => {
            const polygons: [number, number][][] = [
                [[0, 0], [2, 0], [2, 2], [0, 2]],
                [[5, 5], [7, 5], [7, 7], [5, 7]]
            ];
            expect(pointInAnyPolygon([3, 3], polygons)).toBe(false);
        });

        test('point in multiple overlapping polygons', () => {
            const polygons: [number, number][][] = [
                [[0, 0], [2, 0], [2, 2], [0, 2]],
                [[1, 1], [3, 1], [3, 3], [1, 3]]
            ];
            expect(pointInAnyPolygon([1.5, 1.5], polygons)).toBe(true);
        });

        test('empty polygon array', () => {
            expect(pointInAnyPolygon([1, 1], [])).toBe(false);
        });

        test('single polygon array', () => {
            const polygons: [number, number][][] = [
                [[0, 0], [2, 0], [2, 2], [0, 2]]
            ];
            expect(pointInAnyPolygon([1, 1], polygons)).toBe(true);
            expect(pointInAnyPolygon([3, 3], polygons)).toBe(false);
        });

        test('three polygons with point in last', () => {
            const polygons: [number, number][][] = [
                [[0, 0], [1, 0], [1, 1], [0, 1]],
                [[2, 2], [3, 2], [3, 3], [2, 3]],
                [[4, 4], [6, 4], [6, 6], [4, 6]]
            ];
            expect(pointInAnyPolygon([5, 5], polygons)).toBe(true);
        });
    });

    describe('filterRiddenRoadsToBbox', () => {
        const bbox = { north: 1, south: 0, east: 1, west: 0 };

        test('keeps an activity with a point inside the bbox', () => {
            const roads: [number, number][][] = [[[0.5, 0.5], [0.6, 0.6]]];
            expect(filterRiddenRoadsToBbox(roads, bbox)).toEqual(roads);
        });

        test('keeps an activity within the padding threshold outside the bbox', () => {
            const roads: [number, number][][] = [[[1.0001, 0.5]]];
            expect(filterRiddenRoadsToBbox(roads, bbox, 50)).toEqual(roads);
        });

        test('drops an activity entirely outside the bbox and padding', () => {
            const roads: [number, number][][] = [[[10, 10], [11, 11]]];
            expect(filterRiddenRoadsToBbox(roads, bbox, 50)).toEqual([]);
        });

        test('keeps a whole activity, unmodified, when any point matches', () => {
            const roads: [number, number][][] = [[[10, 10], [0.5, 0.5], [20, 20]]];
            expect(filterRiddenRoadsToBbox(roads, bbox)).toEqual(roads);
        });

        test('passes through null/empty input', () => {
            expect(filterRiddenRoadsToBbox(null, bbox)).toBeNull();
            expect(filterRiddenRoadsToBbox(undefined, bbox)).toBeNull();
            expect(filterRiddenRoadsToBbox([], bbox)).toEqual([]);
        });
    });

    describe('isolated unridden pockets', () => {
        // Regression coverage for a real report: a lasso drawn around a neighborhood
        // included a genuinely-unridden block whose only connections back to the rest
        // of the selection were via already-ridden streets. solveCPP used to silently
        // drop any such "pocket" whenever the round-trip detour cost more than 3x the
        // pocket's own unridden length (see the removed SKIP_DETOUR_MULTIPLIER logic)
        // -- so that block vanished from the generated route with only a console log,
        // despite sitting inside the user's own lasso. Every required edge is already
        // unridden by construction (the box/polygon filters exclude isRidden roads
        // before adding to requiredEdges), so an isolated pocket is always real,
        // deliberately-selected fresh mileage -- it should always be bridged in.
        test('a short unridden pocket reachable only via a much longer ridden detour is still included', () => {
            const mockData: OverpassResponse = {
                version: 0.6,
                generator: 'test',
                osm3s: { timestamp_osm_base: '', copyright: '' },
                elements: [
                    // Main unridden loop.
                    { type: 'node', id: 1, lat: 0, lon: 0 },
                    { type: 'node', id: 2, lat: 0, lon: 0.001 },
                    { type: 'node', id: 3, lat: 0.001, lon: 0.001 },
                    { type: 'node', id: 4, lat: 0.001, lon: 0 },
                    { type: 'way', id: 100, nodes: [1, 2, 3, 4, 1], tags: { highway: 'residential' } },
                    // Long already-ridden bridge (~2226m) — far more than 3x the pocket's
                    // own length, which is exactly what the old skip heuristic dropped.
                    { type: 'node', id: 5, lat: 0.001, lon: 0.02 },
                    { type: 'way', id: 200, nodes: [4, 5], tags: { highway: 'residential' } },
                    // Short unridden pocket (~22m), only reachable via the ridden bridge.
                    { type: 'node', id: 6, lat: 0.0012, lon: 0.02 },
                    { type: 'way', id: 300, nodes: [5, 6], tags: { highway: 'residential' } },
                ]
            };
            const riddenRoads: [number, number][][] = [[[0.001, 0], [0.001, 0.02]]];

            const graph = new StreetGraph();
            graph.buildFromOSM(mockData, riddenRoads);
            expect(graph.graph.getLink('4', '5')!.data.isRidden).toBe(true);
            expect(graph.graph.getLink('5', '6')!.data.isRidden).toBe(false);

            const selectionBoxes = [{ north: 0.002, south: -0.001, east: 0.021, west: -0.001 }];
            const circuit = graph.solveCPP(undefined, undefined, undefined, selectionBoxes);

            const visits = (lat: number, lon: number) =>
                circuit.some(p => Math.abs(p.lat - lat) < 1e-9 && Math.abs(p.lon - lon) < 1e-9);
            expect(visits(0.001, 0.02)).toBe(true);  // node 5
            expect(visits(0.0012, 0.02)).toBe(true); // node 6
        });
    });
});
