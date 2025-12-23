// @ts-ignore
import createGraph, { Graph } from 'ngraph.graph';

// @ts-ignore
import eulerianTrail from 'eulerian-trail';

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

export class StreetGraph {
    graph: Graph<NodeData, EdgeData>;

    constructor() {
        this.graph = createGraph({ multigraph: true });
    }

    public buildFromOSM(data: OverpassResponse, riddenRoads: [number, number][][] | null = null) {
        const nodesMap = new Map<number, OSMNode>();

        // First pass: Index nodes
        for (const elem of data.elements) {
            if (elem.type === 'node') {
                nodesMap.set(elem.id, elem);
                this.graph.addNode(elem.id.toString(), {
                    lat: elem.lat,
                    lon: elem.lon,
                    degree: 0
                });
            }
        }

        // Second pass: Add edges from ways
        for (const elem of data.elements) {
            if (elem.type === 'way') {
                const way = elem as OSMWay;
                for (let i = 0; i < way.nodes.length - 1; i++) {
                    const u = way.nodes[i].toString();
                    const v = way.nodes[i + 1].toString();

                    if (this.graph.hasNode(u) && this.graph.hasNode(v)) {
                        const uNode = nodesMap.get(way.nodes[i]);
                        const vNode = nodesMap.get(way.nodes[i + 1]);

                        if (uNode && vNode) {
                            const dist = this.haversine(uNode.lat, uNode.lon, vNode.lat, vNode.lon);
                            const isRidden = this.checkIfRidden(uNode, vNode, riddenRoads);

                            // Add undirected edge (represented as two directed)
                            this.graph.addLink(u, v, {
                                id: way.id.toString(),
                                weight: dist,
                                name: way.tags?.name,
                                isRidden
                            });
                            this.graph.addLink(v, u, {
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
    }

    private checkIfRidden(u: OSMNode, v: OSMNode, riddenRoads: [number, number][][] | null): boolean {
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

            // PRE-CHECK: Broad activity BBox
            // To make this efficient, activities should ideally have their BBox cached.
            // Since we don't have it cached yet, let's do a quick scan if it's the first time
            // Or just rely on the point-in-bbox check which is already fast.
            // Actually, we can just check THE FIRST AND LAST POINT of the activity? No, that's not safe.

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
        const R = 6371e3; // metres
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
                    // Fallback iteration
                    node.links.forEach(() => degree++);
                }
            }

            // Since we represent each undirected edge as two directed edges (in/out),
            // the total number of links is 2 * (undirected degree).
            // We want to find nodes where undirected degree is odd.
            // So we check if (total_links / 2) is odd.
            // Or simply: total_links % 4 !== 0 (assuming strictly symmetric graph).
            // But safely: (degree / 2) % 2 !== 0.

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

        // Sort by size (descending)
        components.sort((a, b) => b.length - a.length);

        console.log(`${ts()} Found ${components.length} connected components. Keeping largest (${components[0].length} nodes). Removing ${components.length - 1} islands.`);

        // Remove all nodes in smaller components
        for (let i = 1; i < components.length; i++) {
            for (const nodeId of components[i]) {
                this.graph.removeNode(nodeId);
            }
        }
    }

    public findClosestTarget(fromId: string, targetIds: Set<string>): { path: { id: string, idNext: string, weight: number }[], targetId: string } | null {
        const distances = new Map<string, number>();
        const previous = new Map<string, { id: string, linkId: string, linkWeight: number }>();
        const unvisited = new Set<string>();

        this.graph.forEachNode(node => {
            distances.set(node.id.toString(), Infinity);
            unvisited.add(node.id.toString());
        });
        distances.set(fromId, 0);

        while (unvisited.size > 0) {
            let minNode: string | null = null;
            let minDist = Infinity;

            for (const nodeId of unvisited) {
                const d = distances.get(nodeId)!;
                if (d < minDist) {
                    minDist = d;
                    minNode = nodeId;
                }
            }

            if (minNode === null || minDist === Infinity) break;

            // IF WE FOUND ANY TARGET
            if (targetIds.has(minNode) && minNode !== fromId) {
                const path: { id: string, idNext: string, weight: number }[] = [];
                let curr = minNode;
                while (curr !== fromId) {
                    const prev = previous.get(curr);
                    if (!prev) break;
                    path.unshift({ id: prev.id, idNext: curr, weight: prev.linkWeight });
                    curr = prev.id;
                }
                return { path, targetId: minNode };
            }

            unvisited.delete(minNode);

            this.graph.getNode(minNode)?.links?.forEach((link: any) => {
                const neighborId = (link.fromId === minNode ? link.toId : link.fromId).toString();
                if (unvisited.has(neighborId)) {
                    const penalty = link.data.isRidden ? 10 : 1;
                    const alt = minDist + (link.data.weight * penalty);
                    if (alt < distances.get(neighborId)!) {
                        distances.set(neighborId, alt);
                        previous.set(neighborId, { id: minNode!, linkId: link.id, linkWeight: link.data.weight });
                    }
                }
            });
        }

        return null;
    }

    public findPath(fromId: string, toId: string): { id: string, idNext: string, weight: number }[] {
        const result = this.findClosestTarget(fromId, new Set([toId]));
        return result ? result.path : [];
    }

    public solveCPP(): { lat: number, lon: number }[] {
        console.log(`${ts()} Starting RPP Solver...`);

        // 1. Identify required edges (E_R) - those un-ridden
        const requiredEdges: { u: string, v: string, link: any }[] = [];
        const unriddenNodes = new Set<string>();

        this.graph.forEachLink((link: any) => {
            if (link.fromId < link.toId) {
                if (!link.data.isRidden) {
                    requiredEdges.push({ u: link.fromId.toString(), v: link.toId.toString(), link });
                    unriddenNodes.add(link.fromId.toString());
                    unriddenNodes.add(link.toId.toString());
                }
            }
        });

        if (requiredEdges.length === 0) {
            console.log(`${ts()} No unridden roads found in this area.`);
            return [];
        }

        // 2. Find connected components of unridden roads
        let components: string[][] = [];
        const visitedNodes = new Set<string>();

        for (const startNode of unriddenNodes) {
            if (!visitedNodes.has(startNode)) {
                const component: string[] = [];
                const stack = [startNode];
                visitedNodes.add(startNode);
                while (stack.length > 0) {
                    const u = stack.pop()!;
                    component.push(u);
                    this.graph.getNode(u)?.links?.forEach((link: any) => {
                        if (!link.data.isRidden) {
                            const v = (link.fromId === u ? link.toId : link.fromId).toString();
                            if (!visitedNodes.has(v)) {
                                visitedNodes.add(v);
                                stack.push(v);
                            }
                        }
                    });
                }
                components.push(component);
            }
        }

        console.log(`${ts()} Found ${components.length} unridden road components.`);
        components.sort((a, b) => b.length - a.length);

        // 3. Connect components to the largest component (The Main Body)
        const edgesInFinalGraph: { u: string, v: string, data: EdgeData }[] = [];
        const activeUnriddenNodes = new Set<string>();
        const reachableComponents: string[][] = [components[0]];

        // Populate initial edges from the largest component
        const mainComponentNodes = new Set(components[0]);
        requiredEdges.forEach(re => {
            if (mainComponentNodes.has(re.u) || mainComponentNodes.has(re.v)) {
                // We'll filter strictly later, but for now we track nodes in the main component
            }
        });

        console.log(`${ts()} Connecting islands to the mainland...`);
        for (let i = 1; i < components.length; i++) {
            const island = components[i];
            const targetNodes = new Set<string>();
            reachableComponents.forEach(c => c.forEach(n => targetNodes.add(n)));

            const result = this.findClosestTarget(island[0], targetNodes);
            if (result) {
                reachableComponents.push(island);
                // Add the connecting path edges to the final graph
                result.path.forEach(p => {
                    const link = this.graph.getLink(p.id, p.idNext);
                    if (link) {
                        edgesInFinalGraph.push({ u: p.id, v: p.idNext, data: { ...link.data, isVirtual: true } });
                    }
                });
            } else {
                console.warn(`${ts()} Pruning unreachable island of ${island.length} nodes.`);
            }
        }

        // Add all required edges from reachable components
        const finalReachableNodes = new Set<string>();
        reachableComponents.forEach(c => c.forEach(n => finalReachableNodes.add(n)));

        requiredEdges.forEach(re => {
            if (finalReachableNodes.has(re.u) && finalReachableNodes.has(re.v)) {
                edgesInFinalGraph.push({ u: re.u, v: re.v, data: re.link.data });
            }
        });

        // 4. Odd Node Matching
        const degreeMap = new Map<string, number>();
        edgesInFinalGraph.forEach(e => {
            degreeMap.set(e.u, (degreeMap.get(e.u) || 0) + 1);
            degreeMap.set(e.v, (degreeMap.get(e.v) || 0) + 1);
        });

        const oddNodes: string[] = [];
        for (const [node, degree] of degreeMap.entries()) {
            if (degree % 2 !== 0) oddNodes.push(node);
        }

        if (oddNodes.length > 0) {
            console.log(`${ts()} Matching ${oddNodes.length} odd nodes...`);
            const oddSet = new Set(oddNodes);
            while (oddSet.size > 0) {
                const u = oddSet.values().next().value as string;
                oddSet.delete(u);

                const result = this.findClosestTarget(u, oddSet);
                if (result) {
                    oddSet.delete(result.targetId);
                    result.path.forEach(p => {
                        const link = this.graph.getLink(p.id, p.idNext);
                        if (link) {
                            edgesInFinalGraph.push({ u: p.id, v: p.idNext, data: { ...link.data, isVirtual: true } });
                        }
                    });
                } else {
                    // This is a major connectivity issue. If we can't match an odd node, 
                    // we HAVE to double one of its existing edges to make it even.
                    console.error(`${ts()} Critical: Could not match odd node ${u}. Doubling an existing edge as fallback.`);
                    const node = this.graph.getNode(u);
                    if (node && node.links && node.links.size > 0) {
                        const link = Array.from(node.links)[0] as any;
                        const v = (link.fromId === u ? link.toId : link.fromId).toString();
                        edgesInFinalGraph.push({ u, v, data: { ...link.data, isVirtual: true } });
                    }
                }
            }
        }

        // 5. Final Eulerian Trail Build
        console.log(`${ts()} Final Graph: ${edgesInFinalGraph.length} edges.`);

        // Final connectivity check
        const nodesInCircuit = new Set<string>();
        edgesInFinalGraph.forEach(e => { nodesInCircuit.add(e.u); nodesInCircuit.add(e.v); });

        // Verify degrees again
        const finalDegreeMap = new Map<string, number>();
        edgesInFinalGraph.forEach(e => {
            finalDegreeMap.set(e.u, (finalDegreeMap.get(e.u) || 0) + 1);
            finalDegreeMap.set(e.v, (finalDegreeMap.get(e.v) || 0) + 1);
        });
        const remainingOdd = Array.from(finalDegreeMap.values()).filter(d => d % 2 !== 0).length;
        if (remainingOdd > 0) {
            console.error(`${ts()} Final graph Still has ${remainingOdd} odd nodes! Eulerian construction WILL fail.`);
            // Potentially add one more loop to fix this if critical
        }

        try {
            const finalEdges: [string, string][] = edgesInFinalGraph.map(e => [e.u, e.v]);
            const trail = eulerianTrail({ edges: finalEdges });
            const circuit = trail.map((nodeId: string) => {
                const node = this.graph.getNode(nodeId);
                return { lat: node?.data.lat || 0, lon: node?.data.lon || 0 };
            });
            console.log(`${ts()} RPP Solver complete. Result: ${circuit.length} points.`);
            return circuit;
        } catch (e: any) {
            console.error(`${ts()} Eulerian trail construction failed:`, e.message);
            throw e;
        }
    }
}
