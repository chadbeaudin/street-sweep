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
}

const ts = () => `[${new Date().toTimeString().slice(0, 8)}]`;

const GRAPH_CACHE = new Map<string, { graph: StreetGraph; timestamp: number }>();
const CACHE_TTL = 1000 * 60 * 60; // 1 hour

export class StreetGraph {
    graph: Graph<NodeData, EdgeData>;

    public static getCachedGraph(bbox: { south: number; west: number; north: number; east: number }, data: OverpassResponse): StreetGraph {
        const key = `${bbox.south.toFixed(4)},${bbox.west.toFixed(4)},${bbox.north.toFixed(4)},${bbox.east.toFixed(4)}`;
        const now = Date.now();
        const cached = GRAPH_CACHE.get(key);
        if (cached && (now - cached.timestamp < CACHE_TTL)) {
            console.log(`${ts()} Returning cached StreetGraph for ${key}`);
            return cached.graph;
        }
        const newGraph = new StreetGraph();
        newGraph.buildFromOSM(data);
        GRAPH_CACHE.set(key, { graph: newGraph, timestamp: now });
        return newGraph;
    }

    constructor() {
        this.graph = createGraph({ multigraph: true });
    }

    public buildFromOSM(data: OverpassResponse, riddenRoads: [number, number][][] | null = null) {
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

                        const dist = this.haversine(uCoord.lat, uCoord.lon, vCoord.lat, vCoord.lon);
                        const isRidden = this.checkIfRidden(uCoord, vCoord, riddenRoads);

                        this.graph.addLink(uIdStr, vIdStr, {
                            id: way.id.toString(),
                            weight: dist,
                            name: way.tags?.name,
                            isRidden
                        });
                        this.graph.addLink(vIdStr, uIdStr, {
                            id: way.id.toString(),
                            weight: dist,
                            name: way.tags?.name,
                            isRidden
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

    public solveCPP(startPoint?: { lat: number, lon: number }, endPoint?: { lat: number, lon: number }, manualRoute?: [number, number][], selectionBox?: { north: number, south: number, east: number, west: number } | null): { lat: number, lon: number }[] {
        console.log(`${ts()} Starting RPP Solver...`);

        const requiredEdges: { u: string, v: string, link: any }[] = [];
        const unriddenNodes = new Set<string>();
        const allowedLinks = new Set<string>();

        if (manualRoute && manualRoute.length > 1) {
            console.log(`${ts()} Constraining routing to ${manualRoute.length} manual points.`);
            for (let i = 0; i < manualRoute.length - 1; i++) {
                const p1 = manualRoute[i];
                const p2 = manualRoute[i + 1];
                const u = this.findClosestNode(p1[1], p1[0]);
                const v = this.findClosestNode(p2[1], p2[0]);
                if (u && v && u !== v) {
                    const link = this.graph.getLink(u, v);
                    if (link) {
                        allowedLinks.add(link.id);
                        const exists = requiredEdges.find(re => (re.u === u && re.v === v) || (re.u === v && re.v === u));
                        if (!exists) {
                            requiredEdges.push({ u, v, link });
                            unriddenNodes.add(u);
                            unriddenNodes.add(v);
                        }
                    }
                }
            }
        }

        // Add all roads that fall within the selection box to required edges
        if (selectionBox) {
            console.log(`${ts()} Identifying roads in selection box...`);
            this.graph.forEachLink((link: any) => {
                const u = this.graph.getNode(link.fromId);
                const v = this.graph.getNode(link.toId);
                if (u && v) {
                    const midLat = (u.data.lat + v.data.lat) / 2;
                    const midLon = (u.data.lon + v.data.lon) / 2;

                    if (midLat <= selectionBox.north && midLat >= selectionBox.south &&
                        midLon <= selectionBox.east && midLon >= selectionBox.west) {

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

        if (!manualRoute && !selectionBox) {
            this.graph.forEachLink((link: any) => {
                if (link.fromId < link.toId) {
                    if (!link.data.isRidden) {
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
            // Increase search limit for bridging large components
            const searchLimit = Math.min(island.length, 20);
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
                    if (link) edgesInFinalGraph.push({ u: p.id, v: p.idNext, data: { ...link.data, isVirtual: true } });
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
        while (remainingOdd.size > 0) {
            const u = Array.from(remainingOdd)[0];
            const targets = new Set(remainingOdd);
            targets.delete(u);
            // Allow matching across ANY link
            const res = this.findClosestTarget(u, targets);
            if (res) {
                remainingOdd.delete(u);
                remainingOdd.delete(res.targetId);
                res.path.forEach(p => {
                    const link = this.graph.getLink(p.id, p.idNext);
                    if (link) edgesInFinalGraph.push({ u: p.id, v: p.idNext, data: { ...link.data, isVirtual: true } });
                });
            } else {
                const node = Array.from(remainingOdd)[0];
                remainingOdd.delete(node);
                console.error("Could not match odd node", node);
            }
        }

        try {
            const finalEdges: [string, string][] = edgesInFinalGraph.map(e => [e.u, e.v]);
            let trail: string[];
            try {
                trail = eulerianTrail({ edges: finalEdges, startNode: startNode || undefined });
            } catch (err) {
                console.warn(`${ts()} Eulerian trail discovery failed. Falling back to simple edge list.`, err);
                // Fallback: return nodes of all edges in sequence (not a perfect path, but better than nothing)
                const fallbackNodes: string[] = [];
                edgesInFinalGraph.forEach(e => {
                    if (fallbackNodes.length === 0 || fallbackNodes[fallbackNodes.length - 1] !== e.u) fallbackNodes.push(e.u);
                    fallbackNodes.push(e.v);
                });
                trail = fallbackNodes;
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
            return trail.map((id: string) => {
                const n = this.graph.getNode(id);
                return { lat: n?.data.lat || 0, lon: n?.data.lon || 0 };
            });
        } catch (e: any) {
            console.error("Route construction failed:", e.message);
            throw e;
        }
    }
}
