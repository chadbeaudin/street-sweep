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
}

const ts = () => `[${new Date().toTimeString().slice(0, 8)}]`;

const GRAPH_CACHE = new Map<string, { graph: StreetGraph; timestamp: number }>();
const CACHE_TTL = 1000 * 60 * 60; // 1 hour

// Spatial index cell size in degrees (~55m at equator). Small enough to
// keep cell buckets tiny, large enough that typical clicks find candidates
// within a 1-2 ring expansion.
const GRID_DEG = 0.0005;

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
        GRAPH_CACHE.set(key, { graph: newGraph, timestamp: now });
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

                // SAFETY: Always exclude interstates/trunks from the graph entirely
                if (highway === 'motorway' || highway === 'trunk' || highway === 'motorway_link' || highway === 'trunk_link') {
                    continue;
                }

                const surface = way.tags?.surface;
                let isAvoided = false;

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
                        // Multiply distance for avoided roads to discourage their use in routing
                        if (isAvoided) {
                            dist *= 100;
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

        const thresholdMeters = 20;
        const midLat = (u.lat + v.lat) / 2;
        const midLon = (u.lon + v.lon) / 2;
        const centerLat = Math.floor(midLat / GRID_DEG);
        const centerLon = Math.floor(midLon / GRID_DEG);

        // 1-ring expansion: GRID_DEG (~55m) > threshold (20m), so neighbors cover all candidates
        for (let dLat = -1; dLat <= 1; dLat++) {
            for (let dLon = -1; dLon <= 1; dLon++) {
                const bucket = this.riddenIndex.get(`${centerLat + dLat}:${centerLon + dLon}`);
                if (!bucket) continue;
                for (const point of bucket) {
                    if (this.haversine(midLat, midLon, point[0], point[1]) < thresholdMeters) return true;
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

    public getOddDegreeNodes(): string[] {
        const oddNodes: string[] = [];
        this.graph.forEachNode((node: any) => {
            let degree = 0;
            if (node.links) {
                if (typeof node.links.size === 'number') {
                    degree = node.links.size;
                } else if (typeof node.links.length === 'number') {
                    degree = node.links.length;
                } else {
                    node.links.forEach(() => degree++);
                }
            }
            if ((degree / 2) % 2 !== 0) {
                oddNodes.push(node.id.toString());
            }
        });
        return oddNodes;
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
        const adj = new Map<string, { id: number, target: string }[]>();
        let edgeCounter = 0;
        
        for (const e of edges) {
            const id = edgeCounter++;
            if (!adj.has(e.u)) adj.set(e.u, []);
            if (!adj.has(e.v)) adj.set(e.v, []);
            adj.get(e.u)!.push({ id, target: e.v });
            adj.get(e.v)!.push({ id, target: e.u });
        }

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
                
                if (stack.length >= 2 && unused.length > 1) {
                    const prevNodeId = stack[stack.length - 2];
                    const prevNode = this.graph.getNode(prevNodeId);
                    const currNode = this.graph.getNode(curr);
                    
                    if (prevNode && currNode) {
                        const inBearing = this.calculateBearing(prevNode.data.lat, prevNode.data.lon, currNode.data.lat, currNode.data.lon);
                        
                        let bestScore = -Infinity;
                        for (let i = 0; i < unused.length; i++) {
                            const nextNodeId = unused[i].target;
                            
                            if (nextNodeId === prevNodeId) {
                                // Heavily penalize immediate U-turns
                                const score = -1000;
                                if (score > bestScore) { bestScore = score; bestIdx = i; }
                                continue;
                            }
                            
                            const nextNode = this.graph.getNode(nextNodeId);
                            if (nextNode) {
                                const outBearing = this.calculateBearing(currNode.data.lat, currNode.data.lon, nextNode.data.lat, nextNode.data.lon);
                                const diff = this.getAngleDifference(inBearing, outBearing);
                                
                                // We want the smallest angle difference (closest to 0) to "go straight"
                                const score = -diff;
                                if (score > bestScore) {
                                    bestScore = score;
                                    bestIdx = i;
                                }
                            }
                        }
                    }
                }
                
                const next = unused[bestIdx];
                usedEdges.add(next.id);
                stack.push(next.target);
            }
        }

        trailPath.reverse();
        
        if (usedEdges.size < edges.length) {
            throw new Error(`Partial solution - disconnected graph detected. Traversed ${usedEdges.size} of ${edges.length} edges.`);
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

    public findAllTargets(fromId: string, targetIds: Set<string>, allowedLinks?: Set<string>): Map<string, { path: { id: string, idNext: string, weight: number }[], weight: number }> {
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
                const weight = link.data.weight;
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

    public solveCPP(startPoint?: { lat: number, lon: number }, endPoint?: { lat: number, lon: number }, manualRoute?: [number, number][], selectionBoxes?: { north: number, south: number, east: number, west: number }[] | null): { lat: number, lon: number, hasConstruction?: boolean }[] {
        console.log(`${ts()} Starting RPP Solver... Inputs: manualRoute=${manualRoute?.length || 0} pts, selectionBoxes=${selectionBoxes?.length || 0}`);

        // Mixed mode: point route is fixed, area coverage is appended.
        // Generate the area circuit freely (no forced start/end) so the CPP matching
        // is not pinned to the junction node, which previously caused long diagonal
        // bridge edges radiating from the junction across the entire area.
        // Then rotate the circuit so it begins at the point closest to the junction.
        if (manualRoute && manualRoute.length > 1 && selectionBoxes && selectionBoxes.length > 0) {
            const manualCoords = manualRoute.map(p => ({ lon: p[0], lat: p[1] }));
            const lastPt = manualRoute[manualRoute.length - 1];
            const junction = { lat: lastPt[1], lon: lastPt[0] };

            const areaCircuit = this.solveCPP(undefined, undefined, undefined, selectionBoxes);
            if (areaCircuit.length === 0) return manualCoords;

            // areaCircuit is a closed loop (first ≈ last). Strip the closing duplicate,
            // rotate to the point nearest the junction, then re-close.
            const isClosedLoop =
                areaCircuit.length > 1 &&
                Math.abs(areaCircuit[0].lat - areaCircuit[areaCircuit.length - 1].lat) < 1e-7 &&
                Math.abs(areaCircuit[0].lon - areaCircuit[areaCircuit.length - 1].lon) < 1e-7;
            const base = isClosedLoop ? areaCircuit.slice(0, -1) : areaCircuit;

            let closestIdx = 0;
            let minDist = Infinity;
            for (let i = 0; i < base.length; i++) {
                const d = this.haversine(junction.lat, junction.lon, base[i].lat, base[i].lon);
                if (d < minDist) { minDist = d; closestIdx = i; }
            }

            const rotated = isClosedLoop
                ? [...base.slice(closestIdx), ...base.slice(0, closestIdx), base[closestIdx]]
                : base;

            return [...manualCoords, ...rotated];
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

            this.graph.forEachLink((link: any) => {
                if (link.data.isAvoided) return;
                if (link.data.isRidden) return;

                const u = this.graph.getNode(link.fromId);
                const v = this.graph.getNode(link.toId);

                if (u && v) {
                    // Expand each box by ~20m to catch streets just outside the drawn edge
                    const BOX_BUFFER = 0.0002;
                    const isRequired = selectionBoxes.some(box => {
                        const uIn = u.data.lat <= box.north + BOX_BUFFER && u.data.lat >= box.south - BOX_BUFFER &&
                            u.data.lon <= box.east + BOX_BUFFER && u.data.lon >= box.west - BOX_BUFFER;
                        const vIn = v.data.lat <= box.north + BOX_BUFFER && v.data.lat >= box.south - BOX_BUFFER &&
                            v.data.lon <= box.east + BOX_BUFFER && v.data.lon >= box.west - BOX_BUFFER;
                        return uIn || vIn;
                    });

                    if (isRequired) {
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
        }

        if ((!manualRoute || manualRoute.length === 0) && (!selectionBoxes || selectionBoxes.length === 0)) {
            this.graph.forEachLink((link: any) => {
                if (link.fromId < link.toId) {
                    if (!link.data.isRidden && !link.data.isAvoided) {
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
                        // We allow traversal across ANY link to discover connectivity,
                        // even if we only "require" some of them.
                        const v = (link.fromId === u ? link.toId : link.fromId).toString();
                        if (!visitedNodes.has(v)) {
                            visitedNodes.add(v);
                            stack.push(v);
                        }
                    });
                }
                components.push(component);
            }
        }
        components.sort((a, b) => b.length - a.length);

        const edgesInFinalGraph: { u: string, v: string, data: EdgeData }[] = [];
        const reachableNodes = new Set(components[0]);

        for (let i = 1; i < components.length; i++) {
            const island = components[i];
            let bestResult: any = null;
            let minW = Infinity;
            // Increase search limit for bridging components to 1000 (effectively infinite for local chunks)
            const searchLimit = Math.min(island.length, 1000);
            for (let j = 0; j < searchLimit; j++) {
                // IMPORTANT: When connecting islands, we allow using ANY link in the graph (not just allowedLinks)
                const res = this.findClosestTarget(island[j], reachableNodes);
                if (res) {
                    const w = res.path.reduce((sum: number, p: any) => sum + p.weight, 0);
                    if (w < minW) { minW = w; bestResult = res; }
                }
            }
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

        const startNode = startPoint ? this.findClosestNode(startPoint.lat, startPoint.lon, reachableNodes) : null;
        const endNode = endPoint ? this.findClosestNode(endPoint.lat, endPoint.lon, reachableNodes) : null;

        const dMap = new Map<string, number>();
        edgesInFinalGraph.forEach(e => {
            dMap.set(e.u, (dMap.get(e.u) || 0) + 1);
            dMap.set(e.v, (dMap.get(e.v) || 0) + 1);
        });

        const nodesToFlip = new Set<string>();
        for (const [n, d] of dMap.entries()) if (d % 2 !== 0) nodesToFlip.add(n);

        if (startNode && endNode && startNode !== endNode) {
            if (nodesToFlip.has(startNode)) nodesToFlip.delete(startNode); else nodesToFlip.add(startNode);
            if (nodesToFlip.has(endNode)) nodesToFlip.delete(endNode); else nodesToFlip.add(endNode);
        }

        const remainingOdd = new Set(nodesToFlip);
        console.log(`${ts()} Matching ${remainingOdd.size} odd nodes using APSP + 2-opt approach...`);
        
        const oddArray = Array.from(remainingOdd);
        const distMatrix = new Map<string, Map<string, { weight: number, path: any[] }>>();
        
        // 1. Compute APSP for odd nodes
        for (const u of oddArray) {
            const res = this.findAllTargets(u, remainingOdd);
            distMatrix.set(u, res);
        }

        // 2. Global Greedy Base Matching
        const currentMatches: { u: string, v: string, weight: number, path: any[] }[] = [];
        const unmatched = new Set(oddArray);
        
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
        
        allPairs.sort((a, b) => a.weight - b.weight);
        
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

        // Forced bridging for any isolated odd nodes (safety fallback)
        for (const u of Array.from(unmatched)) {
             unmatched.delete(u);
             console.error(`${ts()} Could not match odd node ${u}. Adding forced bridge.`);
             const forced = this.findClosestTarget(u, reachableNodes);
             if (forced) {
                 forced.path.forEach((p: any) => {
                     const link = this.graph.getLink(p.id, p.idNext);
                     if (link) edgesInFinalGraph.push({ u: p.id, v: p.idNext, data: { ...link.data, isVirtual: true } });
                 });
             }
        }

        // 3. 2-Opt Local Search to find absolute minimum weight perfect matching
        let improved = true;
        let iterations = 0;
        while (improved && iterations < 100) {
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
                if (improved) break; // Restart loop if improved
            }
        }
        
        console.log(`${ts()} 2-opt complete after ${iterations} iterations.`);

        // Apply final matched paths to the graph
        for (const match of currentMatches) {
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
                            let bestRepair: any = null;
                            let minW = Infinity;
                            const limit = Math.min(island.length, 1000);
                            for (let j = 0; j < limit; j++) {
                                const res = this.findClosestTarget(island[j], mainComp);
                                if (res) {
                                    const w = res.path.reduce((sum: number, p: any) => sum + p.weight, 0);
                                    if (w < minW) { minW = w; bestRepair = res; }
                                }
                            }

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
            // Filter out virtual bridge edges - we'll return the route WITHOUT the bridges
            // This means the route may have gaps, but it's more honest than showing fake straight lines
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
