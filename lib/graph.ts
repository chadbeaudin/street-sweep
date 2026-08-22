// @ts-ignore
import createGraph, { Graph } from 'ngraph.graph';
// @ts-ignore
import path from 'ngraph.path';

import { OSMWay, OSMNode, OverpassResponse } from './types';

interface NodeData {
    lat: number;
    lon: number;
    degree: number;
}

interface EdgeData {
    id: string; // usually wayId
    weight: number; // length in meters
    name?: string;
    isVirtual?: boolean;
    isRidden?: boolean;
    isAvoided?: boolean;
    highway?: string;
    hasConstruction?: boolean;
}

export interface RoutingOptions {
    avoidGravel?: boolean;
    avoidHighways?: boolean;
    avoidTrails?: boolean;
    riddenPenalty?: number;
}

const ts = () => `[${new Date().toTimeString().slice(0, 8)}]`;

const GRAPH_CACHE = new Map<string, { graph: StreetGraph; timestamp: number }>();
const CACHE_TTL = 1000 * 60 * 60; // 1 hour

// Default penalty for previously-ridden roads. Can be overridden per-request.
const DEFAULT_RIDDEN_PENALTY = 15;
// Odd-node (T-join) matching penalty for ridden roads. Deliberately much lower than
// DEFAULT_RIDDEN_PENALTY: that value made the matcher double back on long unridden
// required roads instead of taking a short ridden connector (#48). But using no
// penalty at all (as before this constant) let the matcher freely route through
// long ridden stretches whenever marginally shorter than doubling back. This value
// still favors real short connectors while discouraging casual ridden-road use.
const MATCHING_RIDDEN_PENALTY = 4;

// Spatial index cell size in degrees (~55m at equator). Small enough to
// keep cell buckets tiny, large enough that typical clicks find candidates
// within a 1-2 ring expansion.
const GRID_DEG = 0.0005;

// Cache polygon bounding boxes for faster rejection
const polygonBounds = new globalThis.Map<number, { minLat: number; maxLat: number; minLon: number; maxLon: number }>();

export function getPolygonBounds(polygon: [number, number][]): { minLat: number; maxLat: number; minLon: number; maxLon: number } {
    let minLat = polygon[0][0], maxLat = polygon[0][0];
    let minLon = polygon[0][1], maxLon = polygon[0][1];
    for (const [lat, lon] of polygon) {
        minLat = Math.min(minLat, lat);
        maxLat = Math.max(maxLat, lat);
        minLon = Math.min(minLon, lon);
        maxLon = Math.max(maxLon, lon);
    }
    return { minLat, maxLat, minLon, maxLon };
}

// Check if a point [lat, lon] is inside a polygon using ray casting algorithm
export function pointInPolygon(point: [number, number], polygon: [number, number][]): boolean {
    const [x, y] = point;

    // Quick bounding box check first (much faster than ray casting)
    const bounds = getPolygonBounds(polygon);
    if (x < bounds.minLat || x > bounds.maxLat || y < bounds.minLon || y > bounds.maxLon) {
        return false;
    }

    // Ray casting algorithm for actual point-in-polygon test
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
        const [xi, yi] = polygon[i];
        const [xj, yj] = polygon[j];

        const intersect = ((yi > y) !== (yj > y)) && (x < ((xj - xi) * (y - yi)) / (yj - yi) + xi);
        if (intersect) inside = !inside;
    }

    return inside;
}

// Check if a point is inside any of the given polygons
export function pointInAnyPolygon(point: [number, number], polygons: [number, number][][]): boolean {
    return polygons.some(polygon => pointInPolygon(point, polygon));
}

// The entry bridge (approach → area sweep, mixed mode) carries no coverage
// guarantee — only the area's own CPP-solved path does. So any edge the
// bridge shares with the path's own leading edges is pure redundant mileage:
// walking it via the bridge and then immediately again via the path is a
// visible backtrack with no coverage benefit (see #64). Safe to trim from the
// bridge's tail, walking backward only as long as it exactly mirrors the
// path's start — this can never drop required coverage since the path itself
// is never modified. (The symmetric exit-bridge case is NOT safe to trim the
// same way — see the comment at its one call site — so this only handles entry.)
export function trimBridgeOverlap(
    bridge: { lat: number; lon: number }[],
    path: { lat: number; lon: number }[]
): { lat: number; lon: number }[] {
    if (bridge.length < 2 || path.length < 2) return bridge;
    const key = (p: { lat: number; lon: number }) => `${p.lat.toFixed(6)},${p.lon.toFixed(6)}`;
    let trimCount = 0;
    const maxTrim = Math.min(bridge.length - 1, path.length - 1);
    while (trimCount < maxTrim) {
        const bridgeNode = bridge[bridge.length - 2 - trimCount];
        const pathNode = path[1 + trimCount];
        if (key(bridgeNode) !== key(pathNode)) break;
        trimCount++;
    }
    if (trimCount === 0) return bridge;
    return bridge.slice(0, bridge.length - trimCount);
}

// Binary min-heap for Dijkstra. Replaces the previous `queue.sort()` on
// every iteration (which was O(n log n) per dequeue, making pathfinding
// O(V^2 log V) instead of O((V+E) log V)).
class MinHeap<T> {
    private heap: { k: number; v: T }[] = [];
    size(): number { return this.heap.length; }
    push(value: T, key: number): void {
        const h = this.heap;
        h.push({ k: key, v: value });
        let i = h.length - 1;
        while (i > 0) {
            const p = (i - 1) >> 1;
            if (h[p].k <= h[i].k) break;
            [h[p], h[i]] = [h[i], h[p]];
            i = p;
        }
    }
    pop(): T | undefined {
        const h = this.heap;
        if (h.length === 0) return undefined;
        const top = h[0].v;
        const last = h.pop()!;
        if (h.length > 0) {
            h[0] = last;
            let i = 0;
            const n = h.length;
            while (true) {
                const l = 2 * i + 1, r = 2 * i + 2;
                let s = i;
                if (l < n && h[l].k < h[s].k) s = l;
                if (r < n && h[r].k < h[s].k) s = r;
                if (s === i) break;
                [h[i], h[s]] = [h[s], h[i]];
                i = s;
            }
        }
        return top;
    }
}

export class StreetGraph {
    graph: Graph<NodeData, EdgeData>;

    // Lazy spatial indices. Built on first query, invalidated on
    // buildFromOSM. Cached on the graph instance so they survive across
    // multiple /api/step calls via the GRAPH_CACHE.
    private nodeIndex: Map<string, string[]> | null = null;
    private edgeIndex: Map<string, any[]> | null = null;
    private riddenIndex: Map<string, [number, number][]> | null = null;

    public static getCachedGraph(bbox: { south: number; west: number; north: number; east: number }, data: OverpassResponse, riddenRoads: [number, number][][] | null = null, options?: RoutingOptions): StreetGraph {
        const optionsKey = options ? `|G${options.avoidGravel}|H${options.avoidHighways}|T${options.avoidTrails}` : '';
        const key = `${bbox.south.toFixed(4)},${bbox.west.toFixed(4)},${bbox.north.toFixed(4)},${bbox.east.toFixed(4)}${optionsKey}`;
        const now = Date.now();
        const cached = GRAPH_CACHE.get(key);
        if (cached && (now - cached.timestamp < CACHE_TTL)) {
            console.log(`${ts()} Returning cached StreetGraph for ${key}`);
            return cached.graph;
        }
        const newGraph = new StreetGraph();
        newGraph.buildFromOSM(data, riddenRoads, options);
        // Don't cache empty graphs — OSM data may have been transiently unavailable
        if (newGraph.graph.getNodesCount() > 0) {
            GRAPH_CACHE.set(key, { graph: newGraph, timestamp: now });
        }
        return newGraph;
    }

    constructor() {
        this.graph = createGraph({ multigraph: true });
    }

    public buildFromOSM(data: OverpassResponse, riddenRoads: [number, number][][] | null = null, options?: RoutingOptions) {
        console.log(`${ts()} Building graph with options:`, options);
        // Any prior spatial indices are stale.
        this.nodeIndex = null;
        this.edgeIndex = null;
        this.riddenIndex = null;
        const nodesMap = new Map<number, { lat: number, lon: number }>();

        // Debug: log first few nodes to verify coordinate parsing
        const nodeElements = data.elements.filter(e => e.type === 'node').slice(0, 3);
        if (nodeElements.length > 0) {
            console.log(`${ts()}   First ${nodeElements.length} OSM nodes:`, nodeElements.map((n: any) => `[${n.lat},${n.lon}]`));
        }

        if (riddenRoads && riddenRoads.length > 0) this.buildRiddenIndex(riddenRoads);

        // 1. First pass: Collect any top-level node elements (for backward compatibility/tests)
        for (const elem of data.elements) {
            if (elem.type === 'node') {
                nodesMap.set(elem.id, { lat: elem.lat, lon: elem.lon });
                // We don't necessarily add them to graph yet, just index them
            }
        }

        // 2. Second pass: Process ways
        for (const elem of data.elements) {
            if (elem.type === 'way') {
                const way = elem as OSMWay;
                if (!way.nodes) continue;

                const highway = way.tags?.highway;

                // Reject non-routable highway types regardless of data source (cache may contain
                // footways/paths from an earlier fetch before the OSM API filter was added).
                const ROUTABLE_HIGHWAYS = new Set(['motorway','trunk','primary','secondary','tertiary',
                    'unclassified','residential','living_street','motorway_link','trunk_link',
                    'primary_link','secondary_link','tertiary_link','track','cycleway']);
                if (!highway || !ROUTABLE_HIGHWAYS.has(highway)) continue;

                // SAFETY: Exclude actual motorway lanes — cyclists cannot ride on them.
                // trunk is kept (with isAvoided=true) so divided-highway crossings remain connected.
                if (highway === 'motorway') {
                    continue;
                }

                const surface = way.tags?.surface;
                // trunk/motorway_link/trunk_link are kept in the graph for crossing connectivity
                // but treated as always-avoided so CPP never targets them for coverage and the
                // snap function skips them (they're not displayed on the map).
                let isAvoided = highway === 'trunk' || highway === 'motorway_link' || highway === 'trunk_link';

                // Determine if this way should be avoided
                const majorHighways = ['motorway', 'trunk', 'primary', 'secondary', 'motorway_link', 'trunk_link', 'primary_link', 'secondary_link'];
                if (options?.avoidHighways && majorHighways.includes(highway || '')) {
                    isAvoided = true;
                }
                if (!isAvoided && options?.avoidTrails && ['path', 'track', 'footway', 'cycleway'].includes(highway || '')) {
                    isAvoided = true;
                }
                if (!isAvoided && options?.avoidGravel) {
                    const gravelSurfaces = ['gravel', 'dirt', 'unpaved', 'sand', 'compacted', 'fine_gravel', 'earth', 'ground', 'woodchips', 'grass', 'mud'];
                    if (surface && gravelSurfaces.includes(surface)) {
                        isAvoided = true;
                    } else if (highway === 'track' && !surface) {
                        isAvoided = true;
                    }
                }

                // Detect construction
                const hasConstruction =
                    way.tags?.construction !== undefined ||
                    way.tags?.['construction:highway'] !== undefined ||
                    highway === 'construction';

                for (let i = 0; i < way.nodes.length - 1; i++) {
                    const uId = way.nodes[i];
                    const vId = way.nodes[i + 1];
                    const uIdStr = uId.toString();
                    const vIdStr = vId.toString();

                    // Try to get coordinates from inline geometry or nodesMap fallback
                    const uCoord = way.geometry?.[i] || nodesMap.get(uId);
                    const vCoord = way.geometry?.[i + 1] || nodesMap.get(vId);

                    if (uCoord && vCoord) {
                        // Ensure nodes exist in the graph
                        if (!this.graph.hasNode(uIdStr)) {
                            this.graph.addNode(uIdStr, { lat: uCoord.lat, lon: uCoord.lon, degree: 0 });
                        }
                        if (!this.graph.hasNode(vIdStr)) {
                            this.graph.addNode(vIdStr, { lat: vCoord.lat, lon: vCoord.lon, degree: 0 });
                        }

                        let dist = this.haversine(uCoord.lat, uCoord.lon, vCoord.lat, vCoord.lon);
                        // Multiply distance for avoided roads to discourage their use in routing.
                        // This is a soft penalty, not a hard block — findPath/findClosestTarget
                        // weight by distance without excluding isAvoided links, so a route that
                        // genuinely needs a trunk segment (e.g. pins dropped directly on one)
                        // still uses it; it's just deprioritized when a real alternative exists.
                        // trunk: 12x with "Avoid Highways" on (prefer alternatives), 2x with it
                        // off (still nudge away from at-grade highway crossings, but let a
                        // direct route use it freely).
                        // trunk_link/motorway_link (on/off ramps): same idea — 30x by default
                        // so a route doesn't wander onto one for no reason, but only 5x with
                        // "Avoid Highways" off so a route that actually needs the ramp (e.g. to
                        // reach a trunk road pins were dropped on) can still take it.
                        if (highway === 'trunk') {
                            dist *= options?.avoidHighways ? 12 : 2;
                        } else if (highway === 'motorway_link' || highway === 'trunk_link') {
                            dist *= options?.avoidHighways ? 30 : 5;
                        } else if (isAvoided) {
                            dist *= 50;
                        }
                        const isRidden = this.checkIfRidden(uCoord, vCoord, riddenRoads);

                        this.graph.addLink(uIdStr, vIdStr, {
                            id: way.id.toString(),
                            weight: dist,
                            name: way.tags?.name,
                            highway: highway, // Store highway type for debugging/filtering
                            isRidden,
                            isAvoided,
                            hasConstruction
                        });
                        this.graph.addLink(vIdStr, uIdStr, {
                            id: way.id.toString(),
                            weight: dist,
                            name: way.tags?.name,
                            highway: highway,
                            isRidden,
                            isAvoided,
                            hasConstruction
                        });
                    }
                }
            }
        }
    }

    private buildRiddenIndex(riddenRoads: [number, number][][]): void {
        this.riddenIndex = new Map();
        for (const activity of riddenRoads) {
            for (const point of activity) {
                const cellLat = Math.floor(point[0] / GRID_DEG);
                const cellLon = Math.floor(point[1] / GRID_DEG);
                const key = `${cellLat}:${cellLon}`;
                let bucket = this.riddenIndex.get(key);
                if (!bucket) { bucket = []; this.riddenIndex.set(key, bucket); }
                bucket.push(point);
            }
        }
    }

    private checkIfRidden(u: { lat: number, lon: number }, v: { lat: number, lon: number }, riddenRoads: [number, number][][] | null): boolean {
        if (!riddenRoads || riddenRoads.length === 0 || !this.riddenIndex) return false;

        // Use segment-to-point distance: for each Strava GPS point near this edge,
        // compute the perpendicular distance to the segment u→v rather than checking
        // fixed sample positions. This handles sparse summary_polylines correctly — a
        // GPS point 100m along a 200m edge will be caught regardless of where u/v fall.
        const thresholdMeters = 25;

        // Collect all grid cells that overlap the edge bounding box + threshold
        const minLat = Math.min(u.lat, v.lat);
        const maxLat = Math.max(u.lat, v.lat);
        const minLon = Math.min(u.lon, v.lon);
        const maxLon = Math.max(u.lon, v.lon);
        const pad = thresholdMeters / 111320; // approx degrees per meter

        const cellMinLat = Math.floor((minLat - pad) / GRID_DEG);
        const cellMaxLat = Math.floor((maxLat + pad) / GRID_DEG);
        const cellMinLon = Math.floor((minLon - pad) / GRID_DEG);
        const cellMaxLon = Math.floor((maxLon + pad) / GRID_DEG);

        // Pre-compute segment in flat (meter-like) coords for projection
        const cosLat = Math.cos(((u.lat + v.lat) / 2) * Math.PI / 180);
        const uX = u.lon * cosLat, uY = u.lat;
        const vX = v.lon * cosLat, vY = v.lat;
        const dx = vX - uX, dy = vY - uY;
        const lenSq = dx * dx + dy * dy;

        for (let cLat = cellMinLat; cLat <= cellMaxLat; cLat++) {
            for (let cLon = cellMinLon; cLon <= cellMaxLon; cLon++) {
                const bucket = this.riddenIndex.get(`${cLat}:${cLon}`);
                if (!bucket) continue;
                for (const point of bucket) {
                    // Project point onto segment, clamp to [0,1], measure distance.
                    // Skip endpoint hits (t < 0.05 or t > 0.95): a GPS point at an
                    // intersection is shared by all roads meeting there, so it cannot
                    // prove the rider actually traveled *this* segment.
                    const pX = point[1] * cosLat, pY = point[0];
                    const t = lenSq === 0 ? 0 : Math.max(0, Math.min(1, ((pX - uX) * dx + (pY - uY) * dy) / lenSq));
                    if (t < 0.05 || t > 0.95) continue;
                    const closestLat = uY + t * dy;
                    const closestLon = (uX + t * dx) / cosLat;
                    if (this.haversine(point[0], point[1], closestLat, closestLon) < thresholdMeters) return true;
                }
            }
        }
        return false;
    }

    private haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
        const R = 6371e3;
        const φ1 = lat1 * Math.PI / 180;
        const φ2 = lat2 * Math.PI / 180;
        const Δφ = (lat2 - lat1) * Math.PI / 180;
        const Δλ = (lon2 - lon1) * Math.PI / 180;
        const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
            Math.cos(φ1) * Math.cos(φ2) *
            Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        return R * c;
    }

    private calculateBearing(lat1: number, lon1: number, lat2: number, lon2: number): number {
        const phi1 = lat1 * Math.PI / 180;
        const phi2 = lat2 * Math.PI / 180;
        const lambda1 = lon1 * Math.PI / 180;
        const lambda2 = lon2 * Math.PI / 180;
        const y = Math.sin(lambda2 - lambda1) * Math.cos(phi2);
        const x = Math.cos(phi1) * Math.sin(phi2) -
                  Math.sin(phi1) * Math.cos(phi2) * Math.cos(lambda2 - lambda1);
        const theta = Math.atan2(y, x);
        return (theta * 180 / Math.PI + 360) % 360;
    }

    private getAngleDifference(b1: number, b2: number): number {
        let diff = Math.abs(b1 - b2);
        if (diff > 180) {
            diff = 360 - diff;
        }
        return diff;
    }

    private buildGeographicEulerianTrail(edges: { u: string, v: string, data: any }[], startNodeId: string | null): string[] {
        const ts = () => `[${new Date().toTimeString().slice(0, 8)}]`;
        const adj = new Map<string, { id: number, target: string, isConnector: boolean }[]>();
        let edgeCounter = 0;

        // Track which geometric edges (u-v pairs) have duplicates so we can prefer
        // "fresh" edges over edges whose copies have already been walked.
        const edgePairKey = (a: string, b: string) => a < b ? `${a}|${b}` : `${b}|${a}`;
        const edgePairCount = new Map<string, number>();

        for (const e of edges) {
            const id = edgeCounter++;
            if (!adj.has(e.u)) adj.set(e.u, []);
            if (!adj.has(e.v)) adj.set(e.v, []);
            const isConnector = !!(e.data.isVirtual || e.data.isRidden);
            adj.get(e.u)!.push({ id, target: e.v, isConnector });
            adj.get(e.v)!.push({ id, target: e.u, isConnector });

            const key = edgePairKey(e.u, e.v);
            edgePairCount.set(key, (edgePairCount.get(key) || 0) + 1);
        }

        // Track per-pair used count so we can detect "first traversal of a doubled pair" vs second.
        const edgePairUsed = new Map<string, number>();

        let startNode = startNodeId || edges[0].u;
        const oddNodes = Array.from(adj.entries()).filter(([_, neighbors]) => neighbors.length % 2 !== 0).map(([node]) => node);

        if (oddNodes.length > 0) {
            if (oddNodes.length === 2) {
                if (!startNodeId || !oddNodes.includes(startNodeId)) {
                    startNode = oddNodes[0];
                }
            } else {
                throw new Error(`Graph is not Eulerian (${oddNodes.length} odd nodes)`);
            }
        }

        const usedEdges = new Set<number>();
        const stack: string[] = [startNode];
        const trailPath: string[] = [];

        while (stack.length > 0) {
            const curr = stack[stack.length - 1];
            const neighbors = adj.get(curr) || [];

            const unused = neighbors.filter(n => !usedEdges.has(n.id));

            if (unused.length === 0) {
                trailPath.push(stack.pop()!);
            } else {
                let bestIdx = 0;

                if (unused.length > 1) {
                    const prevNodeId = stack.length >= 2 ? stack[stack.length - 2] : null;
                    const prevNode = prevNodeId ? this.graph.getNode(prevNodeId) : null;
                    const currNode = this.graph.getNode(curr);
                    const inBearing = (prevNode && currNode)
                        ? this.calculateBearing(prevNode.data.lat, prevNode.data.lon, currNode.data.lat, currNode.data.lon)
                        : null;

                    let bestScore = -Infinity;
                    for (let i = 0; i < unused.length; i++) {
                        const candidate = unused[i];
                        const nextNodeId = candidate.target;

                        const pairKey = edgePairKey(curr, nextNodeId);
                        const pairTotal = edgePairCount.get(pairKey) || 1;
                        const pairUsed = edgePairUsed.get(pairKey) || 0;
                        // If this is a duplicate edge AND its first copy was already used,
                        // we're about to do a "second traversal" of a doubled road.
                        const isSecondTraversal = pairTotal > 1 && pairUsed > 0;

                        if (nextNodeId === prevNodeId) {
                            // An immediate U-turn is allowed only to finish the second copy
                            // of the edge we just rode (out-and-back on a doubled spur).
                            // On a bike that's a natural maneuver, and for turn-by-turn
                            // navigation it beats jaunting onto connector roads first.
                            const score = isSecondTraversal ? -5000 : -1e9;
                            if (score > bestScore) { bestScore = score; bestIdx = i; }
                            continue;
                        }

                        // Tiers: fresh required edges (0) > spur-finishing U-turn (-5000,
                        // above) > connectors over ridden/virtual roads that cover nothing
                        // new (-8000) > deferred second traversals (-10000).
                        const isConnector = pairTotal === 1 && candidate.isConnector;
                        let score = isSecondTraversal ? -10000 : (isConnector ? -8000 : 0);

                        // Tiebreaker: bearing (prefer continuing straight)
                        if (inBearing !== null && currNode) {
                            const nextNode = this.graph.getNode(nextNodeId);
                            if (nextNode) {
                                const outBearing = this.calculateBearing(currNode.data.lat, currNode.data.lon, nextNode.data.lat, nextNode.data.lon);
                                const diff = this.getAngleDifference(inBearing, outBearing);
                                score += -diff;
                            }
                        }

                        if (score > bestScore) {
                            bestScore = score;
                            bestIdx = i;
                        }
                    }
                }

                const next = unused[bestIdx];
                usedEdges.add(next.id);
                const pairKey = edgePairKey(curr, next.target);
                edgePairUsed.set(pairKey, (edgePairUsed.get(pairKey) || 0) + 1);
                stack.push(next.target);
            }
        }

        trailPath.reverse();

        if (usedEdges.size < edges.length) {
            throw new Error(`Partial solution - disconnected graph detected. Traversed ${usedEdges.size} of ${edges.length} edges.`);
        }

        // Log U-turn density to detect zig-zag patterns
        let uTurns = 0;
        for (let i = 1; i < trailPath.length - 1; i++) {
            const prevNode = this.graph.getNode(trailPath[i-1]);
            const currNode = this.graph.getNode(trailPath[i]);
            const nextNode = this.graph.getNode(trailPath[i+1]);
            if (prevNode && currNode && nextNode) {
                const inBearing = this.calculateBearing(prevNode.data.lat, prevNode.data.lon, currNode.data.lat, currNode.data.lon);
                const outBearing = this.calculateBearing(currNode.data.lat, currNode.data.lon, nextNode.data.lat, nextNode.data.lon);
                const diff = this.getAngleDifference(inBearing, outBearing);
                if (diff > 150) { // >150 degrees = approximate U-turn
                    uTurns++;
                }
            }
        }
        const uTurnPercent = (uTurns / Math.max(1, trailPath.length - 2) * 100).toFixed(1);
        console.log(`${ts()} Trail U-turn density: ${uTurns}/${trailPath.length} (${uTurnPercent}%)`);

        if (uTurns > trailPath.length * 0.08) {
            console.warn(`${ts()} Detected zig-zag pattern - post-processing to reduce sharp turns`);

            // Post-process: detect and fix adjacent sharp turns by reordering
            // A zig-zag looks like: ...A -> B -> C... where angle(A->B->C) > 120 degrees
            // We'll try to find segments that backtrack and defer them to the end
            const improved: string[] = [];
            const deferred: string[][] = [];
            let i = 0;

            while (i < trailPath.length) {
                improved.push(trailPath[i]);

                // Look ahead for sharp turn patterns
                if (i < trailPath.length - 2) {
                    const prevNode = this.graph.getNode(trailPath[i]);
                    const currNode = this.graph.getNode(trailPath[i + 1]);
                    const nextNode = this.graph.getNode(trailPath[i + 2]);

                    if (prevNode && currNode && nextNode) {
                        const inBearing = this.calculateBearing(prevNode.data.lat, prevNode.data.lon, currNode.data.lat, currNode.data.lon);
                        const outBearing = this.calculateBearing(currNode.data.lat, currNode.data.lon, nextNode.data.lat, nextNode.data.lon);
                        const diff = this.getAngleDifference(inBearing, outBearing);

                        // If we detect a sharp turn, try to batch subsequent sharp turns together
                        if (diff > 120) {
                            const segment = [trailPath[i + 1]];
                            let j = i + 2;
                            // Collect consecutive points involved in sharp turns
                            while (j < trailPath.length && j < i + 8) {
                                const p1 = this.graph.getNode(trailPath[j - 1]);
                                const p2 = this.graph.getNode(trailPath[j]);
                                const p3 = j + 1 < trailPath.length ? this.graph.getNode(trailPath[j + 1]) : null;

                                if (p1 && p2 && p3) {
                                    const b1 = this.calculateBearing(p1.data.lat, p1.data.lon, p2.data.lat, p2.data.lon);
                                    const b2 = this.calculateBearing(p2.data.lat, p2.data.lon, p3.data.lat, p3.data.lon);
                                    const d = this.getAngleDifference(b1, b2);
                                    if (d > 120) {
                                        segment.push(trailPath[j]);
                                        j++;
                                    } else {
                                        break;
                                    }
                                } else {
                                    break;
                                }
                            }
                            if (segment.length > 2) {
                                deferred.push(segment);
                                i += segment.length;
                                continue;
                            }
                        }
                    }
                }
                i++;
            }

            // Append deferred segments (they'll be at the end, but at least not interleaved)
            for (const segment of deferred) {
                improved.push(...segment);
            }

            if (improved.length === trailPath.length) {
                // Recompute U-turn count
                let uTurns2 = 0;
                for (let i = 1; i < improved.length - 1; i++) {
                    const prevNode = this.graph.getNode(improved[i-1]);
                    const currNode = this.graph.getNode(improved[i]);
                    const nextNode = this.graph.getNode(improved[i+1]);
                    if (prevNode && currNode && nextNode) {
                        const inBearing = this.calculateBearing(prevNode.data.lat, prevNode.data.lon, currNode.data.lat, currNode.data.lon);
                        const outBearing = this.calculateBearing(currNode.data.lat, currNode.data.lon, nextNode.data.lat, nextNode.data.lon);
                        const diff = this.getAngleDifference(inBearing, outBearing);
                        if (diff > 150) uTurns2++;
                    }
                }
                console.log(`${ts()}   After post-processing: ${uTurns2}/${improved.length} U-turns (${(uTurns2 / improved.length * 100).toFixed(1)}%)`);
                return improved;
            }
        }

        return trailPath;
    }

    public pruneDisconnectedComponents() {
        if (this.graph.getNodesCount() === 0) return;
        const visited = new Set<string>();
        const components: string[][] = [];
        this.graph.forEachNode((node) => {
            if (!visited.has(node.id.toString())) {
                const component: string[] = [];
                const stack = [node.id.toString()];
                visited.add(node.id.toString());
                while (stack.length > 0) {
                    const u = stack.pop()!;
                    component.push(u);
                    this.graph.getNode(u)?.links?.forEach((link: any) => {
                        const v = (link.fromId === u ? link.toId : link.fromId).toString();
                        if (!visited.has(v)) {
                            visited.add(v);
                            stack.push(v);
                        }
                    });
                }
                components.push(component);
            }
        });
        if (components.length <= 1) return;
        components.sort((a, b) => b.length - a.length);
        for (let i = 1; i < components.length; i++) {
            for (const nodeId of components[i]) {
                this.graph.removeNode(nodeId);
            }
        }
    }

    public findAllTargets(fromId: string, targetIds: Set<string>, allowedLinks?: Set<string>, riddenPenalty: number = DEFAULT_RIDDEN_PENALTY): Map<string, { path: { id: string, idNext: string, weight: number }[], weight: number }> {
        const distances = new Map<string, number>();
        const previous = new Map<string, { id: string, weight: number }>();
        const queue = new MinHeap<{ id: string; weight: number }>();
        queue.push({ id: fromId, weight: 0 }, 0);
        distances.set(fromId, 0);

        const results = new Map<string, { path: { id: string, idNext: string, weight: number }[], weight: number }>();
        const targetsLeft = new Set(targetIds);
        targetsLeft.delete(fromId);

        while (queue.size() > 0) {
            const { id: u, weight: distU } = queue.pop()!;

            // Stale entry: a better path to u was already processed.
            const known = distances.get(u);
            if (known !== undefined && known < distU) continue;

            if (targetsLeft.has(u)) {
                const p: { id: string, idNext: string, weight: number }[] = [];
                let curr = u;
                while (curr !== fromId) {
                    const prev = previous.get(curr)!;
                    p.unshift({ id: prev.id, idNext: curr, weight: prev.weight });
                    curr = prev.id;
                }
                results.set(u, { path: p, weight: distU });
                targetsLeft.delete(u);
                if (targetsLeft.size === 0) break;
            }

            const node = this.graph.getNode(u);
            node?.links?.forEach((link: any) => {
                if (allowedLinks && !allowedLinks.has(link.id)) return;
                const v = (link.fromId === u ? link.toId : link.fromId).toString();
                // Penalise ridden roads heavily so T-join matching prefers unridden bridges
                const weight = link.data.weight * (link.data.isRidden ? riddenPenalty : 1);
                const alt = distU + weight;

                if (!distances.has(v) || alt < distances.get(v)!) {
                    distances.set(v, alt);
                    previous.set(v, { id: u, weight });
                    queue.push({ id: v, weight: alt }, alt);
                }
            });
        }
        return results;
    }

    public findClosestTarget(
        fromId: string, 
        targetIds: Set<string>, 
        allowedLinks?: Set<string>, 
        penalizedLinks?: Map<string, number>
    ): { path: { id: string, idNext: string, weight: number }[], targetId: string } | null {
        const distances = new Map<string, number>();
        const previous = new Map<string, { id: string, weight: number }>();
        const queue = new MinHeap<{ id: string; weight: number }>();
        queue.push({ id: fromId, weight: 0 }, 0);
        distances.set(fromId, 0);

        let bestTarget: string | null = null;
        let minWeight = Infinity;

        while (queue.size() > 0) {
            const { id: u, weight: distU } = queue.pop()!;

            if (distU > minWeight) break;

            // Stale entry: a better path to u was already processed.
            const known = distances.get(u);
            if (known !== undefined && known < distU) continue;

            if (targetIds.has(u)) {
                if (distU < minWeight) {
                    minWeight = distU;
                    bestTarget = u;
                }
            }

            const node = this.graph.getNode(u);
            node?.links?.forEach((link: any) => {
                if (allowedLinks && !allowedLinks.has(link.id)) return;
                const v = (link.fromId === u ? link.toId : link.fromId).toString();
                
                let weight = link.data.weight;
                if (penalizedLinks && penalizedLinks.has(link.id)) {
                    weight *= penalizedLinks.get(link.id)!;
                }

                const alt = distU + weight;

                if (!distances.has(v) || alt < distances.get(v)!) {
                    distances.set(v, alt);
                    previous.set(v, { id: u, weight });
                    queue.push({ id: v, weight: alt }, alt);
                }
            });
        }

        if (bestTarget) {
            const p: { id: string, idNext: string, weight: number }[] = [];
            let curr = bestTarget;
            while (curr !== fromId) {
                const prev = previous.get(curr)!;
                p.unshift({ id: prev.id, idNext: curr, weight: prev.weight });
                curr = prev.id;
            }
            return { path: p, targetId: bestTarget };
        }

        return null;
    }

    public findPath(
        fromId: string,
        toId: string,
        allowedLinks?: Set<string>,
        penalizedLinks?: Map<string, number>
    ): { id: string, idNext: string, weight: number }[] {
        const result = this.findClosestTarget(fromId, new Set([toId]), allowedLinks, penalizedLinks);
        return result ? result.path : [];
    }

    /**
     * Multi-source Dijkstra: seeds the queue with every node in `fromIds` at distance 0
     * and returns the shortest path to whichever node in `targetIds` is reached first.
     * Used for bridging disconnected components in one pass instead of N single-source runs.
     */
    public findClosestTargetMultiSource(
        fromIds: Set<string>,
        targetIds: Set<string>,
        allowedLinks?: Set<string>,
        penalizedLinks?: Map<string, number>
    ): { path: { id: string, idNext: string, weight: number }[], sourceId: string, targetId: string } | null {
        const distances = new Map<string, number>();
        const previous = new Map<string, { id: string, weight: number }>();
        const sourceOf = new Map<string, string>();
        const queue = new MinHeap<{ id: string; weight: number }>();

        for (const src of fromIds) {
            queue.push({ id: src, weight: 0 }, 0);
            distances.set(src, 0);
            sourceOf.set(src, src);
        }

        while (queue.size() > 0) {
            const { id: u, weight: distU } = queue.pop()!;

            const known = distances.get(u);
            if (known !== undefined && known < distU) continue;

            // First popped target outside the source set is the shortest bridge.
            if (targetIds.has(u) && !fromIds.has(u)) {
                const sourceId = sourceOf.get(u)!;
                const p: { id: string, idNext: string, weight: number }[] = [];
                let curr = u;
                while (curr !== sourceId) {
                    const prev = previous.get(curr)!;
                    p.unshift({ id: prev.id, idNext: curr, weight: prev.weight });
                    curr = prev.id;
                }
                return { path: p, sourceId, targetId: u };
            }

            const node = this.graph.getNode(u);
            node?.links?.forEach((link: any) => {
                if (allowedLinks && !allowedLinks.has(link.id)) return;
                const v = (link.fromId === u ? link.toId : link.fromId).toString();

                let weight = link.data.weight;
                if (penalizedLinks && penalizedLinks.has(link.id)) {
                    weight *= penalizedLinks.get(link.id)!;
                }
                const alt = distU + weight;

                if (!distances.has(v) || alt < distances.get(v)!) {
                    distances.set(v, alt);
                    previous.set(v, { id: u, weight });
                    sourceOf.set(v, sourceOf.get(u)!);
                    queue.push({ id: v, weight: alt }, alt);
                }
            });
        }

        return null;
    }

    /** Returns a penalty map (10×) for all ridden edges, for use when bridging disconnected components. */
    public buildRiddenPenaltyMap(riddenPenalty: number = DEFAULT_RIDDEN_PENALTY): Map<string, number> {
        const penalties = new Map<string, number>();
        this.graph.forEachLink((link: any) => {
            if (link.data.isRidden) penalties.set(link.id, riddenPenalty);
        });
        return penalties;
    }

    /**
     * Inflates the pathfinding weight of graph edges that correspond to already-traversed
     * manualRoute segments. This causes the step-by-step pathfinder to prefer fresh streets
     * over streets that have already been added to the in-progress route, without hard-blocking
     * backtracking (which would be impossible at dead ends).
     * 
     * @param segments  Already-drawn route segments as [[lon,lat], ...] arrays
     * @param multiplier  Weight inflation factor (e.g. 5 = strongly prefer fresh streets)
     */
    /**
     * Finds link IDs that correspond to already-traversed manualRoute segments.
     * Returns a Map of link IDs to the inflation multiplier.
     */
    public getTraversalPenalties(segments: [number, number][][], multiplier: number): Map<string, number> {
        const penalties = new Map<string, number>();
        for (const segment of segments) {
            for (let i = 0; i < segment.length - 1; i++) {
                const [lon1, lat1] = segment[i];
                const [lon2, lat2] = segment[i + 1];

                const n1 = this.findClosestNode(lat1, lon1);
                const n2 = this.findClosestNode(lat2, lon2);
                if (!n1 || !n2 || n1 === n2) continue;

                const link1 = this.graph.getLink(n1, n2);
                if (link1) penalties.set(link1.id, multiplier);

                const link2 = this.graph.getLink(n2, n1);
                if (link2) penalties.set(link2.id, multiplier);
            }
        }
        return penalties;
    }

    /**
     * Inflates the pathfinding weight of graph edges that correspond to already-traversed
     * manualRoute segments.
     * @deprecated Use getTraversalPenalties and pass them to findPath instead for non-mutating search.
     */
    public penalizeTraversedEdges(segments: [number, number][][], multiplier: number): void {
        for (const segment of segments) {
            for (let i = 0; i < segment.length - 1; i++) {
                const [lon1, lat1] = segment[i];
                const [lon2, lat2] = segment[i + 1];

                const n1 = this.findClosestNode(lat1, lon1);
                const n2 = this.findClosestNode(lat2, lon2);
                if (!n1 || !n2 || n1 === n2) continue;

                const link1 = this.graph.getLink(n1, n2);
                if (link1) link1.data.weight *= multiplier;

                const link2 = this.graph.getLink(n2, n1);
                if (link2) link2.data.weight *= multiplier;
            }
        }
    }

    private cellKey(lat: number, lon: number): string {
        const cLat = Math.floor(lat / GRID_DEG);
        const cLon = Math.floor(lon / GRID_DEG);
        return `${cLat}:${cLon}`;
    }

    private buildNodeIndex() {
        const index = new Map<string, string[]>();
        this.graph.forEachNode((node: any) => {
            const key = this.cellKey(node.data.lat, node.data.lon);
            let bucket = index.get(key);
            if (!bucket) { bucket = []; index.set(key, bucket); }
            bucket.push(node.id.toString());
        });
        this.nodeIndex = index;
    }

    private buildEdgeIndex() {
        const index = new Map<string, any[]>();
        const addLinkToCell = (key: string, link: any) => {
            let bucket = index.get(key);
            if (!bucket) { bucket = []; index.set(key, bucket); }
            bucket.push(link);
        };
        const seenLinks = new Set<any>();
        // Safety cap: a single edge can't add itself to more than this many
        // cells. Real OSM way segments are short (<200m) so they touch 1–4
        // cells; this only matters for pathological test inputs.
        const MAX_CELLS_PER_EDGE = 4096;

        this.graph.forEachLink((link: any) => {
            // ngraph multigraph has both u→v and v→u links per edge.
            // Dedupe by edge id so each physical segment is indexed once.
            const edgeKey = `${link.fromId}|${link.toId}|${link.data?.id}`;
            const revKey = `${link.toId}|${link.fromId}|${link.data?.id}`;
            if (seenLinks.has(edgeKey) || seenLinks.has(revKey)) return;
            seenLinks.add(edgeKey);

            const u = this.graph.getNode(link.fromId);
            const v = this.graph.getNode(link.toId);
            if (!u || !v) return;

            const cells = new Set<string>();
            const dLat = v.data.lat - u.data.lat;
            const dLon = v.data.lon - u.data.lon;
            // Rasterize the segment into every cell it passes through by
            // sampling at half-cell intervals.
            const span = Math.max(Math.abs(dLat), Math.abs(dLon));
            const steps = Math.min(MAX_CELLS_PER_EDGE, Math.max(1, Math.ceil((span / GRID_DEG) * 2)));
            for (let s = 0; s <= steps; s++) {
                const t = s / steps;
                cells.add(this.cellKey(u.data.lat + t * dLat, u.data.lon + t * dLon));
            }
            for (const c of cells) addLinkToCell(c, link);
        });
        this.edgeIndex = index;
    }

    // Returns all node IDs from edges within `maxCells` grid cells of (lat, lon).
    // Used as a broad fallback target set when the primary snap-edge nodes are disconnected.
    public findNodeIdsNearPoint(lat: number, lon: number, maxCells: number): Set<string> {
        if (!this.edgeIndex) this.buildEdgeIndex();
        const result = new Set<string>();
        const cLat = Math.floor(lat / GRID_DEG);
        const cLon = Math.floor(lon / GRID_DEG);
        for (let dLat = -maxCells; dLat <= maxCells; dLat++) {
            for (let dLon = -maxCells; dLon <= maxCells; dLon++) {
                const bucket = this.edgeIndex!.get(`${cLat + dLat}:${cLon + dLon}`);
                if (!bucket) continue;
                for (const link of bucket) {
                    result.add(link.fromId.toString());
                    result.add(link.toId.toString());
                }
            }
        }
        return result;
    }

    public findClosestNode(lat: number, lon: number, nodeIds?: Set<string>): string | null {
        // For a small candidate set, just iterate it directly.
        if (nodeIds && nodeIds.size <= 64) {
            let bestId: string | null = null;
            let minDist = Infinity;
            for (const id of nodeIds) {
                const n = this.graph.getNode(id);
                if (!n) continue;
                const d = this.haversine(lat, lon, n.data.lat, n.data.lon);
                if (d < minDist) { minDist = d; bestId = id; }
            }
            return bestId;
        }

        if (!this.nodeIndex) this.buildNodeIndex();

        const centerLat = Math.floor(lat / GRID_DEG);
        const centerLon = Math.floor(lon / GRID_DEG);
        let bestId: string | null = null;
        let minDist = Infinity;

        const MAX_RINGS = 20; // ~1km radius — covers typical dense street networks
        for (let radius = 0; radius <= MAX_RINGS; radius++) {
            for (let dLat = -radius; dLat <= radius; dLat++) {
                for (let dLon = -radius; dLon <= radius; dLon++) {
                    // Only scan the ring's perimeter (skip already-scanned interior)
                    if (radius > 0 && Math.abs(dLat) !== radius && Math.abs(dLon) !== radius) continue;
                    const key = `${centerLat + dLat}:${centerLon + dLon}`;
                    const bucket = this.nodeIndex!.get(key);
                    if (!bucket) continue;
                    for (const id of bucket) {
                        if (nodeIds && !nodeIds.has(id)) continue;
                        const n = this.graph.getNode(id);
                        if (!n) continue;
                        const d = this.haversine(lat, lon, n.data.lat, n.data.lon);
                        if (d < minDist) { minDist = d; bestId = id; }
                    }
                }
            }
            // Once we have a candidate, expand one more ring to confirm
            // nothing closer exists in the next ring out. Approximate
            // degrees-to-meters conversion is good enough as a lower bound.
            if (bestId) {
                const minDegDist = minDist / 111000;
                if (minDegDist < (radius - 1) * GRID_DEG) break;
            }
        }

        // Fallback for sparse graphs (or pathological tests) where no node
        // exists within MAX_RINGS: scan the entire index. This still beats
        // the old O(n) forEachNode because we skip empty cells, but is
        // primarily a correctness safety net.
        if (!bestId) {
            for (const bucket of this.nodeIndex!.values()) {
                for (const id of bucket) {
                    if (nodeIds && !nodeIds.has(id)) continue;
                    const n = this.graph.getNode(id);
                    if (!n) continue;
                    const d = this.haversine(lat, lon, n.data.lat, n.data.lon);
                    if (d < minDist) { minDist = d; bestId = id; }
                }
            }
        }

        return bestId;
    }

    public findClosestPointOnEdge(lat: number, lon: number): { lat: number, lon: number, u: string, v: string } | null {
        if (!this.edgeIndex) this.buildEdgeIndex();

        const centerLat = Math.floor(lat / GRID_DEG);
        const centerLon = Math.floor(lon / GRID_DEG);
        let bestPoint: { lat: number, lon: number, u: string, v: string } | null = null;
        let minDist = Infinity;
        const seen = new Set<any>();

        const tryLink = (link: any) => {
            if (seen.has(link)) return;
            seen.add(link);
            // Don't snap to ramps — they're not visible on the map
            if (link.data.highway === 'trunk' || link.data.highway === 'motorway_link' || link.data.highway === 'trunk_link') return;
            const u = this.graph.getNode(link.fromId);
            const v = this.graph.getNode(link.toId);
            if (!u || !v) return;
            const res = this.pointToSegmentDistance(lat, lon, u.data.lat, u.data.lon, v.data.lat, v.data.lon);
            if (res.distance < minDist) {
                minDist = res.distance;
                bestPoint = { lat: res.lat, lon: res.lon, u: link.fromId.toString(), v: link.toId.toString() };
            }
        };

        const MAX_RINGS = 20;
        for (let radius = 0; radius <= MAX_RINGS; radius++) {
            for (let dLat = -radius; dLat <= radius; dLat++) {
                for (let dLon = -radius; dLon <= radius; dLon++) {
                    if (radius > 0 && Math.abs(dLat) !== radius && Math.abs(dLon) !== radius) continue;
                    const key = `${centerLat + dLat}:${centerLon + dLon}`;
                    const bucket = this.edgeIndex!.get(key);
                    if (!bucket) continue;
                    for (const link of bucket) tryLink(link);
                }
            }
            if (bestPoint) {
                const minDegDist = minDist / 111000;
                if (minDegDist < (radius - 1) * GRID_DEG) break;
            }
        }

        // Fallback for sparse graphs: scan all indexed edges.
        if (!bestPoint) {
            for (const bucket of this.edgeIndex!.values()) {
                for (const link of bucket) tryLink(link);
            }
        }

        return bestPoint;
    }

    private pointToSegmentDistance(pLat: number, pLon: number, lat1: number, lon1: number, lat2: number, lon2: number) {
        const dLat = lat2 - lat1;
        const dLon = lon2 - lon1;

        if (dLat === 0 && dLon === 0) {
            return { distance: this.haversine(pLat, pLon, lat1, lon1), lat: lat1, lon: lon1 };
        }

        // Scale longitude difference by cos(latitude) to account for aspect ratio
        const cosLat = Math.cos(lat1 * Math.PI / 180);
        const dLonScaled = dLon * cosLat;
        const relLonScaled = (pLon - lon1) * cosLat;
        const relLat = pLat - lat1;

        const t = (relLat * dLat + relLonScaled * dLonScaled) / (dLat * dLat + dLonScaled * dLonScaled);

        if (t <= 0) return { distance: this.haversine(pLat, pLon, lat1, lon1), lat: lat1, lon: lon1 };
        if (t >= 1) return { distance: this.haversine(pLat, pLon, lat2, lon2), lat: lat2, lon: lon2 };

        const closestLat = lat1 + t * dLat;
        const closestLon = lon1 + t * dLon;
        return { distance: this.haversine(pLat, pLon, closestLat, closestLon), lat: closestLat, lon: closestLon };
    }

    public solveCPP(startPoint?: { lat: number, lon: number }, endPoint?: { lat: number, lon: number }, manualRoute?: [number, number][], selectionBoxes?: { north: number, south: number, east: number, west: number }[] | null, exitRoute?: [number, number][], approachRoute?: [number, number][], includeRidden = false, riddenPenalty: number = DEFAULT_RIDDEN_PENALTY, selectionPolygons?: [number, number][][] | null, boxElasticityMeters = 0, preferNaturalEndpoint = false): { lat: number, lon: number, hasConstruction?: boolean }[] {
        console.log(`${ts()} Starting RPP Solver... Inputs: manualRoute=${manualRoute?.length || 0} pts, selectionBoxes=${selectionBoxes?.length || 0}`);

        // Mixed mode: point route is fixed, area coverage is appended.
        // Generate the area circuit freely (no forced start/end) so the CPP matching
        // is not pinned to the junction node, which previously caused long diagonal
        // bridge edges radiating from the junction across the entire area.
        // Then rotate the circuit so it begins at the point closest to the junction.
        const hasAreaSelection = (selectionBoxes && selectionBoxes.length > 0) || (selectionPolygons && selectionPolygons.length > 0);
        if (manualRoute && manualRoute.length > 1 && hasAreaSelection) {
            // Mixed mode: walk pre-area waypoints (approachRoute) → area sweep → walk post-area
            // waypoints (exitRoute). The full manualRoute is not used as-is because its final
            // approach→post-area segment would otherwise route around the area instead of through it.
            const approachStart = startPoint ?? { lat: manualRoute[0][1], lon: manualRoute[0][0] };
            // The point the route actually enters the area from: the last pre-area
            // waypoint if there were intermediate stops, otherwise approachStart
            // itself. Distinct from approachStart, which is the route's very FIRST
            // click — using approachStart here was the root cause of a recurring
            // straight-line/backtrack artifact: with a route like A -> B -> [area],
            // the area's own entry node AND its "far corner" target were both being
            // chosen relative to A instead of B, the point actually adjacent to the
            // area. That could pick an entry node far from B and/or a "far corner"
            // that's arbitrary relative to B (sometimes landing right back near B),
            // instead of truly farthest from where the route actually enters.
            const areaEntryReference = (approachRoute && approachRoute.length > 0)
                ? { lat: approachRoute[approachRoute.length - 1][1], lon: approachRoute[approachRoute.length - 1][0] }
                : approachStart;

            // If the caller already knows where the route goes after the area (a real
            // subsequent waypoint / exitRoute, or an explicit endPoint), target the
            // coverage trail's end AT that real destination instead of an arbitrary
            // geometric corner — this directly minimizes the exit bridge's distance
            // (and thus its risk of retracing the trail's own tail, see #64). Only
            // fall back to the "farthest corner from approach" heuristic when there's
            // no real destination to aim for (a one-shot sweep that ends wherever).
            const realExitTarget = (exitRoute && exitRoute.length > 0)
                ? { lat: exitRoute[0][1], lon: exitRoute[0][0] }
                : endPoint;

            let farCorner: { lat: number; lon: number };
            if (realExitTarget) {
                farCorner = realExitTarget;
            } else {
                // Find the corner of the selection area farthest from approachStart.
                // Passing it as endPoint forces the CPP to produce an open Euler path
                // (entry → cover all streets → far corner) instead of a circuit.
                // Consider both box corners and polygon (lasso) vertices so lasso areas
                // get the same open-path treatment as boxes.
                const areaCorners: { lat: number; lon: number }[] = [];
                for (const box of (selectionBoxes ?? [])) {
                    areaCorners.push(
                        { lat: box.north, lon: box.west }, { lat: box.north, lon: box.east },
                        { lat: box.south, lon: box.west }, { lat: box.south, lon: box.east },
                    );
                }
                for (const poly of (selectionPolygons ?? [])) {
                    for (const [lat, lon] of poly) areaCorners.push({ lat, lon });
                }
                farCorner = { lat: 0, lon: 0 };
                let maxCornerDist = -Infinity;
                for (const c of areaCorners) {
                    const d = this.haversine(areaEntryReference.lat, areaEntryReference.lon, c.lat, c.lon);
                    if (d > maxCornerDist) { maxCornerDist = d; farCorner = c; }
                }
            }

            let areaPath = this.solveCPP(areaEntryReference, farCorner, undefined, selectionBoxes, undefined, undefined, false, riddenPenalty, selectionPolygons, boxElasticityMeters, true);
            if (areaPath.length === 0) {
                // All area streets already ridden — re-solve including ridden roads so the
                // route still physically connects through the area rather than cutting off.
                areaPath = this.solveCPP(areaEntryReference, farCorner, undefined, selectionBoxes, undefined, undefined, true, riddenPenalty, selectionPolygons, boxElasticityMeters, true);
            }
            if (areaPath.length === 0) return manualRoute.map(p => ({ lon: p[0], lat: p[1] }));

            // Walk pre-computed approach segments through any intermediate pre-area waypoints,
            // then bridge from the last approach point to the area entry.
            // When no approachRoute is supplied, bridge directly from approachStart.
            const hasApproachRoute = approachRoute && approachRoute.length > 0;
            const entryWalk: { lat: number; lon: number }[] = [];
            let bridgeSource = areaEntryReference;
            if (hasApproachRoute) {
                for (const p of approachRoute!) {
                    entryWalk.push({ lat: p[1], lon: p[0] });
                }
                const last = approachRoute![approachRoute!.length - 1];
                bridgeSource = { lat: last[1], lon: last[0] };
            }

            // Prefer fresh streets over already-ridden ones when bridging into/out of the area.
            const bridgePenalty = this.buildRiddenPenaltyMap(riddenPenalty);

            const areaEntryNodeId = this.findClosestNode(areaPath[0].lat, areaPath[0].lon);
            // Mirror of the exit-bridge fix: target the actual edge bridgeSource snaps
            // onto (both endpoints), not just "closest node" — on rural/sparse graphs
            // a long edge can leave the nearest graph node far from where the approach
            // actually sits, and bridging to that node then jumping straight to the
            // mid-edge point (skipping the real edge geometry) draws a visible
            // straight line across open ground.
            const entryEdgeSnap = this.findClosestPointOnEdge(bridgeSource.lat, bridgeSource.lon);
            const entryStartCandidates = entryEdgeSnap
                ? [entryEdgeSnap.u, entryEdgeSnap.v]
                : [this.findClosestNode(bridgeSource.lat, bridgeSource.lon)].filter((id): id is string => !!id);
            let entryBridge: { lat: number; lon: number }[] = [];
            if (areaEntryNodeId && entryStartCandidates.length > 0) {
                let bridgePath: { id: string, idNext: string, weight: number }[] = [];
                let usedEntryStartId: string | null = null;
                // Check for an exact-match candidate first, before attempting any
                // pathfinding — see the identical reasoning on the exit bridge below.
                if (entryStartCandidates.includes(areaEntryNodeId)) {
                    usedEntryStartId = areaEntryNodeId;
                } else {
                    for (const candidateId of entryStartCandidates) {
                        const p = this.findPath(candidateId, areaEntryNodeId, undefined, bridgePenalty);
                        if (p.length > 0) { bridgePath = p; usedEntryStartId = candidateId; break; }
                    }
                }
                // Walk the "first mile" along the actual snap edge from the precise
                // mid-edge point to the chosen intersection node, instead of leaving a
                // straight-line gap between bridgeSource and the reached node.
                if (entryEdgeSnap && usedEntryStartId && (usedEntryStartId === entryEdgeSnap.u || usedEntryStartId === entryEdgeSnap.v)) {
                    entryBridge.push({ lat: entryEdgeSnap.lat, lon: entryEdgeSnap.lon });
                }
                if (bridgePath.length > 0) {
                    const firstNode = this.graph.getNode(bridgePath[0].id);
                    if (firstNode && (entryBridge.length === 0 || entryBridge[entryBridge.length - 1].lat !== firstNode.data.lat || entryBridge[entryBridge.length - 1].lon !== firstNode.data.lon)) {
                        entryBridge.push({ lat: firstNode.data.lat, lon: firstNode.data.lon });
                    }
                    for (const seg of bridgePath) {
                        const n = this.graph.getNode(seg.idNext);
                        if (n) entryBridge.push({ lat: n.data.lat, lon: n.data.lon });
                    }
                }
            }
            // The bridge carries no coverage guarantee (only areaPath does — see #64),
            // so any edge it shares with areaPath's own leading edges is pure redundant
            // mileage: trim it from the bridge's tail, walking backward only as long as
            // it exactly mirrors areaPath's start. Never touches areaPath itself, so
            // this can never drop required coverage — it only removes a bridge detour
            // that immediately retraces ground the coverage trail is about to walk anyway.
            entryBridge = trimBridgeOverlap(entryBridge, areaPath);

            // Exit bridge: area end → first post-area point (road bridge), then follow
            // pre-computed exit segments between subsequent post-area waypoints.
            // Only built when endPoint is a genuine post-area destination (caller's responsibility).
            const exitBridge: { lat: number; lon: number }[] = [];
            if (endPoint) {
                // Bridge target: first point of exitRoute (first post-area point), or endPoint directly
                const hasExitRoute = exitRoute && exitRoute.length > 0;
                const bridgeTarget = hasExitRoute
                    ? { lat: exitRoute![0][1], lon: exitRoute![0][0] }
                    : endPoint;

                const areaEndNodeId = this.findClosestNode(areaPath[areaPath.length - 1].lat, areaPath[areaPath.length - 1].lon);
                // Target the actual edge the bridgeTarget snaps onto (both endpoints),
                // not just "closest node" — on rural/sparse graphs, edges between
                // intersections can run hundreds of meters, so the nearest graph node
                // can sit far from where the click actually snapped. Bridging to a
                // node and then jumping straight to the mid-edge point (skipping the
                // real edge geometry between them) draws a visible straight line
                // across open ground. Mirrors /api/step's snap-edge handling.
                const edgeSnap = this.findClosestPointOnEdge(bridgeTarget.lat, bridgeTarget.lon);
                const exitStartCandidates = edgeSnap
                    ? [edgeSnap.u, edgeSnap.v]
                    : [this.findClosestNode(bridgeTarget.lat, bridgeTarget.lon)].filter((id): id is string => !!id);
                if (areaEndNodeId && exitStartCandidates.length > 0) {
                    let bridgePath: { id: string, idNext: string, weight: number }[] = [];
                    let usedExitStartId: string | null = null;
                    // Check for an exact-match candidate FIRST, before attempting any
                    // pathfinding. areaEndNodeId can equal a later candidate in the
                    // array (e.g. the natural-endpoint search already landed the area's
                    // trail on the snap edge's "v" node) — trying "u" first would find
                    // a technically-valid but backwards path to the wrong edge endpoint,
                    // locking in a real detour before ever checking that we were already there.
                    if (exitStartCandidates.includes(areaEndNodeId)) {
                        usedExitStartId = areaEndNodeId;
                    } else {
                        for (const candidateId of exitStartCandidates) {
                            const p = this.findPath(areaEndNodeId, candidateId, undefined, bridgePenalty);
                            if (p.length > 0) { bridgePath = p; usedExitStartId = candidateId; break; }
                        }
                    }
                    if (bridgePath.length > 0) {
                        const firstNode = this.graph.getNode(bridgePath[0].id);
                        if (firstNode) exitBridge.push({ lat: firstNode.data.lat, lon: firstNode.data.lon });
                        for (const seg of bridgePath) {
                            const n = this.graph.getNode(seg.idNext);
                            if (n) exitBridge.push({ lat: n.data.lat, lon: n.data.lon });
                        }
                    }
                    // Walk the final "last mile" along the actual snap edge to the
                    // precise mid-edge point, instead of leaving a straight-line gap
                    // between the reached intersection node and bridgeTarget.
                    if (edgeSnap && usedExitStartId && (usedExitStartId === edgeSnap.u || usedExitStartId === edgeSnap.v)) {
                        const last = exitBridge[exitBridge.length - 1];
                        if (!last || last.lat !== edgeSnap.lat || last.lon !== edgeSnap.lon) {
                            exitBridge.push({ lat: edgeSnap.lat, lon: edgeSnap.lon });
                        }
                    }
                }
                // Unlike the entry bridge, trimming the exit bridge's overlap with
                // areaPath's own tail isn't a safe no-op: areaPath already used that
                // ground to legitimately reach its chosen terminus, so if the exit
                // bridge needs to leave via a different edge, retracing part of the
                // tail can be genuinely unavoidable (not a pure duplicate-point
                // artifact like the entry case). Left untrimmed pending a real fix.

                // Append pre-computed road segments between post-area points (C→D, D→E, ...)
                if (hasExitRoute) {
                    for (const p of exitRoute!) {
                        exitBridge.push({ lat: p[1], lon: p[0] });
                    }
                }
            }

            const assembled = [{ lat: approachStart.lat, lon: approachStart.lon }, ...entryWalk, ...entryBridge, ...areaPath, ...exitBridge];
            // Adjacent segments (approachStart/entryWalk/entryBridge/areaPath) are each
            // built independently and can end up meeting at the exact same point —
            // e.g. approachStart itself already IS the trimmed entry bridge's first
            // point. A zero-distance consecutive duplicate carries no information, so
            // it's always safe to collapse regardless of why it occurred.
            const deduped: { lat: number; lon: number; hasConstruction?: boolean }[] = [];
            for (const pt of assembled) {
                const prev = deduped[deduped.length - 1];
                if (!prev || prev.lat !== pt.lat || prev.lon !== pt.lon) deduped.push(pt);
            }
            for (let i = 1; i < deduped.length; i++) {
                const gapM = this.haversine(deduped[i - 1].lat, deduped[i - 1].lon, deduped[i].lat, deduped[i].lon);
                if (gapM > 150) {
                    console.warn(`${ts()} [DEBUG] large gap in assembled mixed-mode route: ${gapM.toFixed(0)}m between index ${i - 1} (${deduped[i - 1].lat},${deduped[i - 1].lon}) and ${i} (${deduped[i].lat},${deduped[i].lon})`);
                }
            }
            return deduped;
        }

        const requiredEdges: { u: string, v: string, link: any }[] = [];
        const requiredEdgeKeys = new Set<string>();
        const unriddenNodes = new Set<string>();
        const allowedLinks = new Set<string>();

        const edgeKey = (a: string, b: string) => a < b ? `${a}|${b}` : `${b}|${a}`;

        if (manualRoute && manualRoute.length > 1) {
            console.log(`${ts()} Identifying mandatory segments from ${manualRoute.length} manual points.`);

            const addRequiredEdge = (fromId: string, toId: string, link: any) => {
                if (!link) return;
                allowedLinks.add(link.id);
                const key = edgeKey(fromId, toId);
                if (!requiredEdgeKeys.has(key)) {
                    requiredEdgeKeys.add(key);
                    requiredEdges.push({ u: fromId, v: toId, link });
                }
                unriddenNodes.add(fromId);
                unriddenNodes.add(toId);
            };

            for (let i = 0; i < manualRoute.length - 1; i++) {
                const p1 = manualRoute[i];
                const p2 = manualRoute[i + 1];

                // Skip duplicate points (segment boundaries in flattened manualRoute share an endpoint)
                if (p1[0] === p2[0] && p1[1] === p2[1]) continue;

                const u = this.findClosestNode(p1[1], p1[0]);
                const v = this.findClosestNode(p2[1], p2[0]);

                if (u && v && u !== v) {
                    const directLink = this.graph.getLink(u, v);
                    if (directLink) {
                        addRequiredEdge(u, v, directLink);
                    } else {
                        // Fallback: If no direct link between manual points, find the path
                        // and add those edges as mandatory. This is critical for sparse manual routes.
                        const path = this.findPath(u, v);
                        path.forEach(seg => {
                            const link = this.graph.getLink(seg.id, seg.idNext);
                            if (link) addRequiredEdge(seg.id, seg.idNext, link);
                        });
                    }
                } else if (u && v && u === v) {
                    // Both endpoints snap to the same node. This happens when the
                    // user's clicked waypoints both fell mid-edge near the same
                    // intersection: the half-edge between the intersection and
                    // the snapped click points would otherwise be skipped, so
                    // the CPP solver never visits that street.
                    //
                    // Identify the edge each endpoint actually lies on, then
                    // mark it mandatory only when both agree. Falling back to
                    // the midpoint (as a previous version did) can snap to a
                    // parallel/crossing road and pin the wrong edge.
                    const snap1 = this.findClosestPointOnEdge(p1[1], p1[0]);
                    const snap2 = this.findClosestPointOnEdge(p2[1], p2[0]);
                    const sameEdge =
                        snap1 && snap2 &&
                        ((snap1.u === snap2.u && snap1.v === snap2.v) ||
                         (snap1.u === snap2.v && snap1.v === snap2.u));
                    if (sameEdge && snap1.u !== snap1.v) {
                        const link = this.graph.getLink(snap1.u, snap1.v) || this.graph.getLink(snap1.v, snap1.u);
                        if (link) addRequiredEdge(snap1.u, snap1.v, link);
                    }
                }
            }
        }

        // Add all roads that fall within any of the selection boxes to required edges
        if (selectionBoxes && selectionBoxes.length > 0) {
            console.log(`${ts()} Identifying roads in ${selectionBoxes.length} selection boxes...`);
            const boxStartTime = Date.now();
            let roadsChecked = 0;
            let roadsIncluded = 0;

            this.graph.forEachLink((link: any) => {
                roadsChecked++;
                if (link.data.isAvoided) return;
                if (link.data.isRidden && !includeRidden) return;

                const u = this.graph.getNode(link.fromId);
                const v = this.graph.getNode(link.toId);

                if (u && v) {
                    // ~10m base buffer to catch streets exactly on the drawn boundary, plus an optional
                    // user-configurable "elasticity" (in meters) that lets required-edge inclusion reach
                    // further beyond the drawn box. This is a direct, unconditional extension — the user
                    // is trading potential extra distance for more swept coverage, on purpose.
                    const BOX_BUFFER = 0.0001 + (boxElasticityMeters > 0 ? boxElasticityMeters / 111320 : 0);
                    const isRequired = selectionBoxes.some(box => {
                        const uIn = u.data.lat <= box.north + BOX_BUFFER && u.data.lat >= box.south - BOX_BUFFER &&
                            u.data.lon <= box.east + BOX_BUFFER && u.data.lon >= box.west - BOX_BUFFER;
                        const vIn = v.data.lat <= box.north + BOX_BUFFER && v.data.lat >= box.south - BOX_BUFFER &&
                            v.data.lon <= box.east + BOX_BUFFER && v.data.lon >= box.west - BOX_BUFFER;
                        return uIn || vIn;
                    });

                    if (isRequired) {
                        roadsIncluded++;
                        allowedLinks.add(link.id);
                        const key = edgeKey(link.fromId.toString(), link.toId.toString());
                        if (!requiredEdgeKeys.has(key)) {
                            requiredEdgeKeys.add(key);
                            requiredEdges.push({ u: link.fromId.toString(), v: link.toId.toString(), link });
                            unriddenNodes.add(link.fromId.toString());
                            unriddenNodes.add(link.toId.toString());
                        }
                    }
                }
            });
            console.log(`${ts()} Box filtering: ${roadsIncluded}/${roadsChecked} roads selected (${Date.now() - boxStartTime}ms)`);
        }

        // Add all roads that fall within any of the selection polygons to required edges
        if (selectionPolygons && selectionPolygons.length > 0) {
            console.log(`${ts()} Identifying roads in ${selectionPolygons.length} selection polygons...`);
            for (let i = 0; i < selectionPolygons.length; i++) {
                const bounds = getPolygonBounds(selectionPolygons[i]);
                console.log(`${ts()}   Polygon ${i}: bounds=[${bounds.minLat.toFixed(4)},${bounds.minLon.toFixed(4)} to ${bounds.maxLat.toFixed(4)},${bounds.maxLon.toFixed(4)}], ${selectionPolygons[i].length} points`);
            }
            const polygonStartTime = Date.now();
            let roadsChecked = 0;
            let roadsIncluded = 0;
            let sampleLogged = 0;

            this.graph.forEachLink((link: any) => {
                roadsChecked++;
                if (link.data.isAvoided) return;
                if (link.data.isRidden && !includeRidden) return;

                const u = this.graph.getNode(link.fromId);
                const v = this.graph.getNode(link.toId);

                if (u && v) {
                    // Check if either endpoint is inside any polygon
                    const uPoint: [number, number] = [u.data.lat, u.data.lon];
                    const vPoint: [number, number] = [v.data.lat, v.data.lon];
                    const isRequired = pointInAnyPolygon(uPoint, selectionPolygons) || pointInAnyPolygon(vPoint, selectionPolygons);

                    if (sampleLogged < 3) {
                        const inPoly = pointInAnyPolygon(uPoint, selectionPolygons);
                        const swapped = pointInAnyPolygon([uPoint[1], uPoint[0]], selectionPolygons);
                        console.log(`${ts()}   Sample road: u=[${uPoint[0].toFixed(4)},${uPoint[1].toFixed(4)}] in=${inPoly}, swapped=${swapped}`);
                        sampleLogged++;
                    }

                    if (isRequired) {
                        roadsIncluded++;
                        allowedLinks.add(link.id);
                        const key = edgeKey(link.fromId.toString(), link.toId.toString());
                        if (!requiredEdgeKeys.has(key)) {
                            requiredEdgeKeys.add(key);
                            requiredEdges.push({ u: link.fromId.toString(), v: link.toId.toString(), link });
                            unriddenNodes.add(link.fromId.toString());
                            unriddenNodes.add(link.toId.toString());
                        }
                    }
                }
            });
            console.log(`${ts()} Polygon filtering: ${roadsIncluded}/${roadsChecked} roads selected (${Date.now() - polygonStartTime}ms)`);
        }

        if ((!manualRoute || manualRoute.length === 0) && (!selectionBoxes || selectionBoxes.length === 0) && (!selectionPolygons || selectionPolygons.length === 0)) {
            this.graph.forEachLink((link: any) => {
                if (link.fromId < link.toId) {
                    if (!link.data.isRidden && !link.data.isAvoided) {
                        const key = edgeKey(link.fromId.toString(), link.toId.toString());
                        requiredEdgeKeys.add(key); // needed for BFS component detection
                        requiredEdges.push({ u: link.fromId.toString(), v: link.toId.toString(), link });
                        unriddenNodes.add(link.fromId.toString());
                        unriddenNodes.add(link.toId.toString());
                    }
                }
            });
        }

        if (this.graph.getNodesCount() === 0) {
            console.warn(`${ts()} Cannot solve CPP: Graph is empty.`);
            return manualRoute ? manualRoute.map(p => ({ lon: p[0], lat: p[1] })) : [];
        }

        if (requiredEdges.length === 0) {
            console.log(`${ts()} No unridden roads or mandatory segments found in this area.`);
            return manualRoute ? manualRoute.map(p => ({ lon: p[0], lat: p[1] })) : [];
        }

        let components: string[][] = [];
        const visitedNodes = new Set<string>();
        for (const node of unriddenNodes) {
            if (!visitedNodes.has(node)) {
                const component: string[] = [];
                const stack = [node];
                visitedNodes.add(node);
                while (stack.length > 0) {
                    const u = stack.pop()!;
                    component.push(u);
                    this.graph.getNode(u)?.links?.forEach((link: any) => {
                        const v = (link.fromId === u ? link.toId : link.fromId).toString();
                        if (visitedNodes.has(v)) return;
                        // Only walk required edges so we correctly detect disconnected
                        // pockets in the required-edge subgraph. Ridden/non-required
                        // roads provide bridges later (findClosestTarget), not here.
                        if (!requiredEdgeKeys.has(edgeKey(u, v))) return;
                        visitedNodes.add(v);
                        stack.push(v);
                    });
                }
                components.push(component);
            }
        }
        components.sort((a, b) => b.length - a.length);

        const edgesInFinalGraph: { u: string, v: string, data: EdgeData }[] = [];
        const reachableNodes = new Set(components[0]);
        const riddenPenaltyMap = this.buildRiddenPenaltyMap(riddenPenalty);

        // Links that represent a real, unridden, road-class street (no cycleways/tracks,
        // no already-ridden segments). Used below to tell a truly isolated unridden pocket
        // (only reachable by detouring through already-ridden roads) apart from an island
        // that just happens to have a fresh road-class connection the required-edge BFS
        // didn't see (it only walks required edges — see #41).
        const freshRoadClassLinkIds = new Set<string>();
        this.graph.forEachLink((link: any) => {
            if (link.data.isRidden || link.data.isAvoided) return;
            if (link.data.highway === 'cycleway' || link.data.highway === 'track') return;
            freshRoadClassLinkIds.add(link.id);
        });
        // An isolated pocket is skipped (left uncovered this trip) rather than force-bridged
        // when detouring in and back out via ridden roads would cost several times more than
        // the pocket itself is worth in fresh mileage.
        const SKIP_DETOUR_MULTIPLIER = 3;

        for (let i = 1; i < components.length; i++) {
            const island = components[i];
            const islandSet = new Set(island);

            const hasFreshRoadConnection = this.findClosestTargetMultiSource(islandSet, reachableNodes, freshRoadClassLinkIds, undefined) !== null;
            if (!hasFreshRoadConnection) {
                const islandLength = requiredEdges.reduce((sum, re) => (islandSet.has(re.u) && islandSet.has(re.v)) ? sum + re.link.data.weight : sum, 0);
                const detour = this.findClosestTargetMultiSource(islandSet, reachableNodes, undefined, undefined);
                const roundTripDetourCost = detour ? detour.path.reduce((s, p) => s + p.weight, 0) * 2 : Infinity;
                if (roundTripDetourCost > islandLength * SKIP_DETOUR_MULTIPLIER) {
                    console.log(`${ts()} Skipping isolated pocket (${island.length} nodes, ${islandLength.toFixed(0)}m required) — only reachable via a ~${roundTripDetourCost.toFixed(0)}m round-trip detour through already-ridden roads.`);
                    continue;
                }
            }

            // Single multi-source Dijkstra from every island node finds the closest
            // (island, reachable) pair in one pass. When connecting islands we allow
            // using ANY link in the graph (no allowedLinks restriction).
            const bestResult = this.findClosestTargetMultiSource(islandSet, reachableNodes, undefined, riddenPenaltyMap);
            if (bestResult) {
                island.forEach(n => reachableNodes.add(n));
                bestResult.path.forEach((p: any) => {
                    const link = this.graph.getLink(p.id, p.idNext);
                    if (link) {
                        edgesInFinalGraph.push({ u: p.id, v: p.idNext, data: { ...link.data, isVirtual: true } });
                        reachableNodes.add(p.id);
                        reachableNodes.add(p.idNext);
                    }
                });
            } else {
                console.warn(`${ts()} Warning: Could not bridge component of size ${island.length}. Some roads may be omitted.`);
            }
        }

        requiredEdges.forEach(re => {
            if (reachableNodes.has(re.u) && reachableNodes.has(re.v)) {
                edgesInFinalGraph.push({ u: re.u, v: re.v, data: re.link.data });
            }
        });

        const dMap = new Map<string, number>();
        edgesInFinalGraph.forEach(e => {
            dMap.set(e.u, (dMap.get(e.u) || 0) + 1);
            dMap.set(e.v, (dMap.get(e.v) || 0) + 1);
        });

        const nodesToFlip = new Set<string>();
        for (const [n, d] of dMap.entries()) if (d % 2 !== 0) nodesToFlip.add(n);

        // A forced endPoint that's a geometric proxy rather than a real user-chosen
        // point (e.g. the "far corner" of a drawn area in mixed mode — see #64) has no
        // relationship to the street graph. Snapping it to the literal nearest node
        // forces that node's parity, which, if it wasn't already a natural odd-degree
        // node, creates an artificial detour to fix up a junction with no real need to
        // be a terminus. When preferNaturalEndpoint is set, prefer the nearest node
        // that's ALREADY odd-degree (a natural candidate to be a trail endpoint) when
        // one exists reasonably close by, falling back to the literal nearest node
        // otherwise. Real user-chosen points (explicit pins, home address) should
        // always snap to the literal nearest node, so this only applies when opted in.
        const NATURAL_ENDPOINT_SEARCH_RADIUS_M = 400;
        const findEndpointNode = (point: { lat: number; lon: number }, preferNatural: boolean): string | null => {
            const literalNearest = this.findClosestNode(point.lat, point.lon, reachableNodes);
            if (!preferNatural) return literalNearest;
            const oddReachable = new Set([...nodesToFlip].filter(n => reachableNodes.has(n)));
            if (oddReachable.size === 0) return literalNearest;
            const naturalNearest = this.findClosestNode(point.lat, point.lon, oddReachable);
            if (!naturalNearest) return literalNearest;
            const naturalNode = this.graph.getNode(naturalNearest);
            if (!naturalNode) return literalNearest;
            const distToNatural = this.haversine(point.lat, point.lon, naturalNode.data.lat, naturalNode.data.lon);
            return distToNatural <= NATURAL_ENDPOINT_SEARCH_RADIUS_M ? naturalNearest : literalNearest;
        };

        // Both start and end get natural-node preference when opted in. Moving the
        // start away from the literal-nearest node would normally just relocate a
        // backtrack into the mixed-mode entry bridge (which snaps independently) —
        // that's handled by trimBridgeOverlap in the mixed-mode branch, which trims
        // the bridge's redundant overlap with this solve's actual start, so the net
        // effect is fewer forced-parity detours with no new backtrack. See #64.
        const startNode = startPoint ? findEndpointNode(startPoint, preferNaturalEndpoint) : null;
        const endNode = endPoint ? findEndpointNode(endPoint, preferNaturalEndpoint) : null;

        if (startNode && endNode && startNode !== endNode) {
            if (nodesToFlip.has(startNode)) nodesToFlip.delete(startNode); else nodesToFlip.add(startNode);
            if (nodesToFlip.has(endNode)) nodesToFlip.delete(endNode); else nodesToFlip.add(endNode);
        }

        const remainingOdd = new Set(nodesToFlip);
        console.log(`${ts()} Matching ${remainingOdd.size} odd nodes using APSP + 2-opt approach...`);
        
        const oddArray = Array.from(remainingOdd);
        const distMatrix = new Map<string, Map<string, { weight: number, path: any[] }>>();
        
        // 1. Compute APSP for odd nodes with a mild ridden penalty (see
        // MATCHING_RIDDEN_PENALTY comment) so short ridden connectors are still
        // preferred over long ones, without out-weighing doubling a nearby
        // required road entirely.
        for (const u of oddArray) {
            const res = this.findAllTargets(u, remainingOdd, undefined, MATCHING_RIDDEN_PENALTY);
            distMatrix.set(u, res);
        }

        // 2. Multiple random initial matchings with 2-opt refinement
        // Greedy alone can get stuck in local minima; try multiple starts to find better matchings
        const allPairs: { u: string, v: string, weight: number }[] = [];
        for (let i = 0; i < oddArray.length; i++) {
            for (let j = i + 1; j < oddArray.length; j++) {
                const u = oddArray[i];
                const v = oddArray[j];
                const res = distMatrix.get(u)?.get(v);
                if (res) {
                    allPairs.push({ u, v, weight: res.weight });
                }
            }
        }

        let bestMatching: { u: string, v: string, weight: number, path: any[] }[] | null = null;
        let bestTotalWeight = Infinity;

        // Try greedy + multiple random starts to escape local minima
        const numStartAttempts = Math.min(5, Math.ceil(oddArray.length / 2));

        for (let attempt = 0; attempt < numStartAttempts; attempt++) {
            let currentMatches: { u: string, v: string, weight: number, path: any[] }[] = [];

            if (attempt === 0) {
                // First: greedy by edge weight
                allPairs.sort((a, b) => a.weight - b.weight);
                const unmatched = new Set(oddArray);
                for (const pair of allPairs) {
                    if (unmatched.has(pair.u) && unmatched.has(pair.v)) {
                        unmatched.delete(pair.u);
                        unmatched.delete(pair.v);
                        currentMatches.push({
                            u: pair.u,
                            v: pair.v,
                            weight: pair.weight,
                            path: distMatrix.get(pair.u)!.get(pair.v)!.path
                        });
                    }
                }
            } else {
                // Random attempts: shuffle and greedily match from randomized order
                const shuffled = allPairs.slice().sort(() => Math.random() - 0.5);
                const unmatched = new Set(oddArray);
                for (const pair of shuffled) {
                    if (unmatched.has(pair.u) && unmatched.has(pair.v)) {
                        unmatched.delete(pair.u);
                        unmatched.delete(pair.v);
                        currentMatches.push({
                            u: pair.u,
                            v: pair.v,
                            weight: pair.weight,
                            path: distMatrix.get(pair.u)!.get(pair.v)!.path
                        });
                    }
                }
            }

            // 3. Apply 2-opt refinement to this matching
            let improved = true;
            let iterations = 0;
            while (improved && iterations < 200) {
                improved = false;
                iterations++;
                for (let i = 0; i < currentMatches.length; i++) {
                    for (let j = i + 1; j < currentMatches.length; j++) {
                        const m1 = currentMatches[i];
                        const m2 = currentMatches[j];

                        const currentWeight = m1.weight + m2.weight;

                        // Option A: Pair (m1.u, m2.u) and (m1.v, m2.v)
                        const w_u1u2 = distMatrix.get(m1.u)?.get(m2.u)?.weight ?? Infinity;
                        const w_v1v2 = distMatrix.get(m1.v)?.get(m2.v)?.weight ?? Infinity;
                        const sumA = w_u1u2 + w_v1v2;

                        // Option B: Pair (m1.u, m2.v) and (m1.v, m2.u)
                        const w_u1v2 = distMatrix.get(m1.u)?.get(m2.v)?.weight ?? Infinity;
                        const w_v1u2 = distMatrix.get(m1.v)?.get(m2.u)?.weight ?? Infinity;
                        const sumB = w_u1v2 + w_v1u2;

                        // Compare and swap if better
                        if (sumA < currentWeight && sumA <= sumB) {
                            currentMatches[i] = { u: m1.u, v: m2.u, weight: w_u1u2, path: distMatrix.get(m1.u)!.get(m2.u)!.path };
                            currentMatches[j] = { u: m1.v, v: m2.v, weight: w_v1v2, path: distMatrix.get(m1.v)!.get(m2.v)!.path };
                            improved = true;
                            break;
                        } else if (sumB < currentWeight) {
                            currentMatches[i] = { u: m1.u, v: m2.v, weight: w_u1v2, path: distMatrix.get(m1.u)!.get(m2.v)!.path };
                            currentMatches[j] = { u: m1.v, v: m2.u, weight: w_v1u2, path: distMatrix.get(m1.v)!.get(m2.u)!.path };
                            improved = true;
                            break;
                        }
                    }
                    if (improved) break;
                }
            }

            const totalWeight = currentMatches.reduce((sum, m) => sum + m.weight, 0);
            if (totalWeight < bestTotalWeight) {
                bestTotalWeight = totalWeight;
                bestMatching = currentMatches;
            }
        }

        const finalMatching = bestMatching || [];
        console.log(`${ts()} Matching found with weight ${bestTotalWeight.toFixed(1)} after ${numStartAttempts} attempts.`);

        // Detailed match logging — coords help identify where doubled edges are visually
        if (finalMatching.length > 0) {
            for (let i = 0; i < finalMatching.length; i++) {
                const m = finalMatching[i];
                const uNode = this.graph.getNode(m.u);
                const vNode = this.graph.getNode(m.v);
                const uCoord = uNode ? `[${uNode.data.lat.toFixed(4)},${uNode.data.lon.toFixed(4)}]` : '?';
                const vCoord = vNode ? `[${vNode.data.lat.toFixed(4)},${vNode.data.lon.toFixed(4)}]` : '?';
                console.log(`${ts()}   Match ${i}: ${uCoord} ↔ ${vCoord} (wt=${m.weight.toFixed(0)}m, ${m.path.length} edges)`);
            }
        }

        // Forced bridging for any isolated odd nodes (safety fallback)
        const unmatched = new Set(oddArray);
        for (const match of finalMatching) {
            unmatched.delete(match.u);
            unmatched.delete(match.v);
        }
        for (const u of Array.from(unmatched)) {
             console.error(`${ts()} Could not match odd node ${u}. Adding forced bridge.`);
             const forced = this.findClosestTarget(u, reachableNodes, undefined, riddenPenaltyMap);
             if (forced) {
                 forced.path.forEach((p: any) => {
                     const link = this.graph.getLink(p.id, p.idNext);
                     if (link) edgesInFinalGraph.push({ u: p.id, v: p.idNext, data: { ...link.data, isVirtual: true } });
                 });
             }
        }

        // Apply final matched paths to the graph
        for (const match of finalMatching) {
            match.path.forEach((p: any) => {
                const link = this.graph.getLink(p.id, p.idNext);
                if (link) edgesInFinalGraph.push({ u: p.id, v: p.idNext, data: { ...link.data, isVirtual: true } });
            });
        }

        try {
            let trail: string[] = [];
            try {
                trail = this.buildGeographicEulerianTrail(edgesInFinalGraph, startNode || null);
            } catch (err) {
                console.warn(`${ts()} Eulerian trail failed. Attempting emergency repair (bridging disconnected components)...`, err);
                let repairSuccess = false;

                try {
                    // EMERGENCY REPAIR logic
                    const adj = new Map<string, string[]>();
                    edgesInFinalGraph.forEach(e => {
                        if (!adj.has(e.u)) adj.set(e.u, []);
                        if (!adj.has(e.v)) adj.set(e.v, []);
                        adj.get(e.u)!.push(e.v);
                        adj.get(e.v)!.push(e.u);
                    });

                    const visited = new Set<string>();
                    const repairComponents: string[][] = [];
                    for (const node of Array.from(adj.keys())) {
                        if (!visited.has(node)) {
                            const comp: string[] = [];
                            const stack = [node];
                            visited.add(node);
                            while (stack.length > 0) {
                                const u = stack.pop()!;
                                comp.push(u);
                                adj.get(u)?.forEach(v => {
                                    if (!visited.has(v)) { visited.add(v); stack.push(v); }
                                });
                            }
                            repairComponents.push(comp);
                        }
                    }

                    if (repairComponents.length > 1) {
                        console.log(`${ts()} Found ${repairComponents.length} disconnected components during repair. Bridging...`);
                        const mainComp = new Set(repairComponents[0]);
                        for (let i = 1; i < repairComponents.length; i++) {
                            const island = repairComponents[i];
                            const bestRepair = this.findClosestTargetMultiSource(new Set(island), mainComp, undefined, riddenPenaltyMap);

                            if (bestRepair) {
                                island.forEach(n => mainComp.add(n));
                                bestRepair.path.forEach((p: any) => {
                                    const link = this.graph.getLink(p.id, p.idNext);
                                    if (link) {
                                        edgesInFinalGraph.push({ u: p.id, v: p.idNext, data: { ...link.data, isVirtual: true } });
                                        edgesInFinalGraph.push({ u: p.idNext, v: p.id, data: { ...link.data, isVirtual: true } });
                                        mainComp.add(p.id);
                                        mainComp.add(p.idNext);
                                    }
                                });
                            }
                        }

                        trail = this.buildGeographicEulerianTrail(edgesInFinalGraph, startNode || null);
                        console.log(`${ts()} Emergency repair successful!`);
                        repairSuccess = true;
                    }
                } catch (repairErr) {
                    console.warn(`${ts()} Repair failed.`, repairErr);
                }

                if (!repairSuccess) {
                    console.warn(`${ts()} Falling back to greedy edge follower.`);
                    const fallbackNodes: string[] = [];
                    const remainingEdges = new Set(edgesInFinalGraph.map((e, idx) => idx));
                    let current = startNode || edgesInFinalGraph[0].u;
                    fallbackNodes.push(current);

                    while (remainingEdges.size > 0) {
                        let bestIdx = -1;
                        let flip = false;
                        for (const idx of remainingEdges) {
                            const e = edgesInFinalGraph[idx];
                            if (e.u === current) { bestIdx = idx; flip = false; break; }
                            if (e.v === current) { bestIdx = idx; flip = true; break; }
                        }

                        if (bestIdx !== -1) {
                            const e = edgesInFinalGraph[bestIdx];
                            current = flip ? e.u : e.v;
                            fallbackNodes.push(current);
                            remainingEdges.delete(bestIdx);
                        } else {
                            const nextIdx = Array.from(remainingEdges)[0];
                            const e = edgesInFinalGraph[nextIdx];
                            fallbackNodes.push(e.u, e.v);
                            current = e.v;
                            remainingEdges.delete(nextIdx);
                        }
                    }
                    trail = fallbackNodes;
                }
            }

            if (startNode) {
                if (startNode !== endNode) {
                    if (trail[0] !== startNode && trail[trail.length - 1] === startNode) trail.reverse();
                } else {
                    const idx = trail.indexOf(startNode);
                    if (idx !== -1 && (trail[0] !== startNode || trail[trail.length - 1] !== startNode)) {
                        const base = trail.slice(0, -1);
                        trail = [...base.slice(idx), ...base.slice(0, idx), startNode];
                    }
                }
            }
            const coords: { lat: number; lon: number; hasConstruction?: boolean }[] = [];

            for (let i = 0; i < trail.length; i++) {
                const id = trail[i];
                const n = this.graph.getNode(id);
                if (!n) continue;

                // Check if the next edge has construction
                let hasConstruction = false;
                if (i < trail.length - 1) {
                    const nextId = trail[i + 1];
                    const edge = edgesInFinalGraph.find(e =>
                        (e.u === id && e.v === nextId) || (e.v === id && e.u === nextId)
                    );

                    if (edge?.data?.hasConstruction) {
                        hasConstruction = true;
                    }

                    // NO LONGER SKIPPING VIRTUAL BRIDGES
                    // We want a continuous path for the user to follow, even if it includes backtracking.
                    // This prevents "jumps" on the map and fragmented GPX files.
                }

                // Add the current node with construction info
                coords.push({
                    lat: n.data.lat,
                    lon: n.data.lon,
                    ...(hasConstruction && { hasConstruction: true })
                });
            }

            // If the user's endpoint click landed mid-edge (not at an
            // intersection), the trail above ends at the nearest intersection
            // node which can be visually past the actual click. Project the
            // endpoint onto its closest edge and truncate (or extend) the
            // coords so the route stops exactly at that point.
            if (endPoint && coords.length > 0) {
                const snap = this.findClosestPointOnEdge(endPoint.lat, endPoint.lon);
                if (snap) {
                    const uNode = this.graph.getNode(snap.u);
                    const vNode = this.graph.getNode(snap.v);
                    if (uNode && vNode) {
                        const distToSnap = this.haversine(endPoint.lat, endPoint.lon, snap.lat, snap.lon);
                        const distToU = this.haversine(endPoint.lat, endPoint.lon, uNode.data.lat, uNode.data.lon);
                        const distToV = this.haversine(endPoint.lat, endPoint.lon, vNode.data.lat, vNode.data.lon);
                        const minNodeDist = Math.min(distToU, distToV);

                        // Only truncate when the click is genuinely mid-edge,
                        // not just slightly off an intersection due to map
                        // rounding. ~5m gap between node and edge snap.
                        const NODE_THRESHOLD_M = 5;
                        if (minNodeDist - distToSnap > NODE_THRESHOLD_M) {
                            const eq = (a: number, b: number) => Math.abs(a - b) < 1e-9;
                            const isU = (c: { lat: number, lon: number }) =>
                                eq(c.lat, uNode.data.lat) && eq(c.lon, uNode.data.lon);
                            const isV = (c: { lat: number, lon: number }) =>
                                eq(c.lat, vNode.data.lat) && eq(c.lon, vNode.data.lon);

                            // Find the last time the route traversed the snap edge.
                            let lastIdx = -1;
                            for (let i = 0; i < coords.length - 1; i++) {
                                const a = coords[i], b = coords[i + 1];
                                if ((isU(a) && isV(b)) || (isV(a) && isU(b))) lastIdx = i;
                            }

                            if (lastIdx !== -1) {
                                // Truncate at the snap point during that traversal.
                                return [...coords.slice(0, lastIdx + 1), { lat: snap.lat, lon: snap.lon }];
                            }

                            // The snap edge was not traversed. If the trail's
                            // final node is one of the snap edge's endpoints,
                            // extend along that edge to the snap point.
                            const last = coords[coords.length - 1];
                            if (isU(last) || isV(last)) {
                                coords.push({ lat: snap.lat, lon: snap.lon });
                            }
                        }
                    }
                }
            }

            return coords;
        } catch (e: any) {
            console.error("Route construction failed:", e.message);
            throw e;
        }
    }
}
