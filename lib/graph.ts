// @ts-ignore
import createGraph, { Graph } from 'ngraph.graph';
// @ts-ignore
import eulerianTrail from 'eulerian-trail';
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

export class StreetGraph {
    graph: Graph<NodeData, EdgeData>;

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
        const nodesMap = new Map<number, { lat: number, lon: number }>();

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

    private checkIfRidden(u: { lat: number, lon: number }, v: { lat: number, lon: number }, riddenRoads: [number, number][][] | null): boolean {
        if (!riddenRoads || riddenRoads.length === 0) return false;

        const thresholdMeters = 20;
        const midLat = (u.lat + v.lat) / 2;
        const midLon = (u.lon + v.lon) / 2;

        const edgeMinLat = Math.min(u.lat, v.lat) - 0.001;
        const edgeMaxLat = Math.max(u.lat, v.lat) + 0.001;
        const edgeMinLon = Math.min(u.lon, v.lon) - 0.001;
        const edgeMaxLon = Math.max(u.lon, v.lon) + 0.001;

        for (const activity of riddenRoads) {
            if (activity.length === 0) continue;
            for (const point of activity) {
                if (point[0] > edgeMinLat && point[0] < edgeMaxLat &&
                    point[1] > edgeMinLon && point[1] < edgeMaxLon) {
                    const dist = this.haversine(midLat, midLon, point[0], point[1]);
                    if (dist < thresholdMeters) return true;
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

    public findClosestTarget(fromId: string, targetIds: Set<string>, allowedLinks?: Set<string>): { path: { id: string, idNext: string, weight: number }[], targetId: string } | null {
        const distances = new Map<string, number>();
        const previous = new Map<string, { id: string, weight: number }>();
        const queue: { id: string, weight: number }[] = [{ id: fromId, weight: 0 }];
        distances.set(fromId, 0);

        let bestTarget: string | null = null;
        let minWeight = Infinity;

        while (queue.length > 0) {
            queue.sort((a, b) => a.weight - b.weight);
            const { id: u, weight: distU } = queue.shift()!;

            if (distU > minWeight) break;
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
                const weight = link.data.weight;
                const alt = distU + weight;

                if (!distances.has(v) || alt < distances.get(v)!) {
                    distances.set(v, alt);
                    previous.set(v, { id: u, weight });
                    queue.push({ id: v, weight: alt });
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

    public findPath(fromId: string, toId: string, allowedLinks?: Set<string>): { id: string, idNext: string, weight: number }[] {
        const result = this.findClosestTarget(fromId, new Set([toId]), allowedLinks);
        return result ? result.path : [];
    }

    public findClosestNode(lat: number, lon: number, nodeIds?: Set<string>): string | null {
        let closestNode: string | null = null;
        let minDist = Infinity;
        const checkNode = (node: any) => {
            const nodeId = node.id.toString();
            if (nodeIds && !nodeIds.has(nodeId)) return;
            const dist = this.haversine(lat, lon, node.data.lat, node.data.lon);
            if (dist < minDist) {
                minDist = dist;
                closestNode = nodeId;
            }
        };
        this.graph.forEachNode(checkNode);
        return closestNode;
    }

    public findClosestPointOnEdge(lat: number, lon: number): { lat: number, lon: number, u: string, v: string } | null {
        let minDist = Infinity;
        let bestPoint: { lat: number, lon: number, u: string, v: string } | null = null;

        this.graph.forEachLink((link: any) => {
            const u = this.graph.getNode(link.fromId);
            const v = this.graph.getNode(link.toId);
            if (!u || !v) return;

            const res = this.pointToSegmentDistance(lat, lon, u.data.lat, u.data.lon, v.data.lat, v.data.lon);
            if (res.distance < minDist) {
                minDist = res.distance;
                bestPoint = { lat: res.lat, lon: res.lon, u: link.fromId.toString(), v: link.toId.toString() };
            }
        });

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

    public solveCPP(startPoint?: { lat: number, lon: number }, endPoint?: { lat: number, lon: number }, manualRoute?: [number, number][], selectionBox?: { north: number, south: number, east: number, west: number } | null): { lat: number, lon: number, hasConstruction?: boolean }[] {
        console.log(`${ts()} Starting RPP Solver... Inputs: manualRoute=${manualRoute?.length || 0} pts, selectionBox=${!!selectionBox}`);

        const requiredEdges: { u: string, v: string, link: any }[] = [];
        const unriddenNodes = new Set<string>();
        const allowedLinks = new Set<string>();

        if (manualRoute && manualRoute.length > 1) {
            console.log(`${ts()} Identifying mandatory segments from ${manualRoute.length} manual points.`);
            for (let i = 0; i < manualRoute.length - 1; i++) {
                const p1 = manualRoute[i];
                const p2 = manualRoute[i + 1];
                // Points are [lon, lat]
                const u = this.findClosestNode(p1[1], p1[0]);
                const v = this.findClosestNode(p2[1], p2[0]);
                if (u && v && u !== v) {
                    // Critical fix: We must find the EXACT link between these nodes
                    // if it exists, as manualRoute points are typically consecutive
                    // nodes from an OSM way.
                    const link = this.graph.getLink(u, v);
                    if (link) {
                        allowedLinks.add(link.id);
                        const exists = requiredEdges.find(re => (re.u === u && re.v === v) || (re.u === v && re.v === u));
                        if (!exists) {
                            requiredEdges.push({ u, v, link });
                            unriddenNodes.add(u);
                            unriddenNodes.add(v);
                        }
                    } else {
                        // If no direct link, we still keep the nodes to ensure they are bridge-able
                        unriddenNodes.add(u);
                        unriddenNodes.add(v);
                    }
                }
            }
        }

        // Add all roads that fall within the selection box to required edges
        if (selectionBox) {
            console.log(`${ts()} Identifying roads in selection box... ${JSON.stringify(selectionBox)}`);
            let totalLinks = 0;
            let insideLinks = 0;
            let avoidedLinks = 0;

            let avoidedCounts: { [key: string]: number } = {};

            this.graph.forEachLink((link: any) => {
                totalLinks++;
                if (link.data.isAvoided) {
                    avoidedLinks++;
                    const type = link.data.highway || 'unknown';
                    avoidedCounts[type] = (avoidedCounts[type] || 0) + 1;
                    return;
                }
                const u = this.graph.getNode(link.fromId);
                const v = this.graph.getNode(link.toId);
                if (u && v) {
                    // Check endpoints instead of midpoint for robustness
                    const uIn = u.data.lat <= selectionBox.north && u.data.lat >= selectionBox.south &&
                        u.data.lon <= selectionBox.east && u.data.lon >= selectionBox.west;
                    const vIn = v.data.lat <= selectionBox.north && v.data.lat >= selectionBox.south &&
                        v.data.lon <= selectionBox.east && v.data.lon >= selectionBox.west;

                    if (uIn || vIn) {
                        // Skip roads that have already been ridden to minimize backtracking
                        if (link.data.isRidden) return;

                        insideLinks++;
                        allowedLinks.add(link.id);
                        const exists = requiredEdges.find(re => (re.u === link.fromId && re.v === link.toId) || (re.u === link.toId && re.v === link.fromId));
                        if (!exists) {
                            requiredEdges.push({ u: link.fromId.toString(), v: link.toId.toString(), link });
                            unriddenNodes.add(link.fromId.toString());
                            unriddenNodes.add(link.toId.toString());
                        }
                    }
                }
            });
        }

        if ((!manualRoute || manualRoute.length === 0) && !selectionBox) {
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

        if (requiredEdges.length === 0) {
            console.log(`${ts()} No unridden roads found in this area.`);
            return [];
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
        const pairs: { u: string, v: string, path: any[], weight: number }[] = [];

        console.log(`${ts()} Matching ${remainingOdd.size} odd nodes using global min-weight greedy approach...`);

        while (remainingOdd.size > 1) {
            let bestPair: any = null;
            let minWeight = Infinity;

            const oddArray = Array.from(remainingOdd);
            // Limit search for massive graphs if necessary, but usually odd nodes are few
            const searchLimit = Math.min(oddArray.length, 100);

            for (let i = 0; i < searchLimit; i++) {
                const u = oddArray[i];
                const targets = new Set(remainingOdd);
                targets.delete(u);

                const res = this.findClosestTarget(u, targets);
                if (res) {
                    const weight = res.path.reduce((sum, p) => sum + p.weight, 0);
                    if (weight < minWeight) {
                        minWeight = weight;
                        bestPair = { u, v: res.targetId, path: res.path, weight };
                    }
                }
                // If we found a very close match, we can stop early to speed up
                if (minWeight < 10) break;
            }

            if (bestPair) {
                remainingOdd.delete(bestPair.u);
                remainingOdd.delete(bestPair.v);
                bestPair.path.forEach((p: any) => {
                    const link = this.graph.getLink(p.id, p.idNext);
                    if (link) edgesInFinalGraph.push({ u: p.id, v: p.idNext, data: { ...link.data, isVirtual: true } });
                });
            } else {
                // Should not happen in a connected component, but for safety:
                const u = oddArray[0];
                remainingOdd.delete(u);
                console.error(`${ts()} Could not match odd node ${u}. Adding forced bridge.`);
                const forced = this.findClosestTarget(u, reachableNodes);
                if (forced) {
                    forced.path.forEach((p: any) => {
                        const link = this.graph.getLink(p.id, p.idNext);
                        if (link) edgesInFinalGraph.push({ u: p.id, v: p.idNext, data: { ...link.data, isVirtual: true } });
                    });
                }
            }
        }

        try {
            const finalEdges: [string, string][] = edgesInFinalGraph.map(e => [e.u, e.v]);
            let trail: string[] = [];
            try {
                // If the graph is disconnected, eulerianTrail often returns a path for just ONE component
                // and ignores the rest. We must verify coverage.
                trail = eulerianTrail({ edges: finalEdges, startNode: startNode || undefined });

                // Coverage Check: If we have many edges but trail is short, we likely missed components.
                // A simple Eulerian trail visits every edge at least once.
                // Trail length should be >= finalEdges.length.
                if (trail.length < finalEdges.length && !startNode && (!manualRoute || manualRoute.length === 0)) {
                    // Only enforce this strictly for area-only monitoring where we expect full coverage
                    console.warn(`${ts()} Partial solution detected (Trail=${trail.length}, Edges=${finalEdges.length}). Triggering repair.`);
                    throw new Error("Partial solution - disconnected graph detected.");
                }

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

                        const repairedEdges: [string, string][] = edgesInFinalGraph.map(e => [e.u, e.v]);
                        trail = eulerianTrail({ edges: repairedEdges, startNode: startNode || undefined });
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
            return coords;
        } catch (e: any) {
            console.error("Route construction failed:", e.message);
            throw e;
        }
    }
}
