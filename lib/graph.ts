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
}

export class StreetGraph {
    graph: Graph<NodeData, EdgeData>;

    constructor() {
        this.graph = createGraph({ multigraph: true });
    }

    public buildFromOSM(data: OverpassResponse) {
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
                            // Add undirected edge (represented as two directed)
                            // ngraph is directed by default
                            this.graph.addLink(u, v, { id: way.id.toString(), weight: dist, name: way.tags?.name });
                            this.graph.addLink(v, u, { id: way.id.toString(), weight: dist, name: way.tags?.name });
                        }
                    }
                }
            }
        }
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

                    this.graph.getNode(u)?.links?.forEach((link) => {
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

        console.log(`Found ${components.length} connected components. Keeping largest (${components[0].length} nodes). Removing ${components.length - 1} islands.`);

        // Remove all nodes in smaller components
        for (let i = 1; i < components.length; i++) {
            for (const nodeId of components[i]) {
                this.graph.removeNode(nodeId);
            }
        }
    }

    public findPath(fromId: string, toId: string): { id: string, idNext: string, weight: number }[] {
        // Dijkstra's Algorithm
        const distances = new Map<string, number>();
        const previous = new Map<string, { id: string, linkId: string, linkWeight: number }>();
        const unvisited = new Set<string>();

        // Init
        this.graph.forEachNode(node => {
            distances.set(node.id.toString(), Infinity);
            unvisited.add(node.id.toString());
        });
        distances.set(fromId, 0);

        while (unvisited.size > 0) {
            // Find min dist node
            let minNode: string | null = null;
            let minDist = Infinity;

            for (const nodeId of unvisited) {
                const d = distances.get(nodeId)!;
                if (d < minDist) {
                    minDist = d;
                    minNode = nodeId;
                }
            }

            if (minNode === null || minDist === Infinity) {
                break; // No reachable nodes left
            }

            if (minNode === toId) {
                break; // Found target
            }

            unvisited.delete(minNode);

            // Explore neighbors
            this.graph.getNode(minNode)?.links?.forEach(link => {
                const neighborId = (link.fromId === minNode ? link.toId : link.fromId).toString();
                if (unvisited.has(neighborId)) {
                    const alt = minDist + link.data.weight;
                    if (alt < distances.get(neighborId)!) {
                        distances.set(neighborId, alt);
                        previous.set(neighborId, { id: minNode!, linkId: link.id, linkWeight: link.data.weight });
                    }
                }
            });
        }

        // Reconstruct path
        const path: { id: string, idNext: string, weight: number }[] = [];
        let curr = toId;
        if (!previous.has(curr) && curr !== fromId) {
            return []; // No path found
        }

        while (curr !== fromId) {
            const prev = previous.get(curr);
            if (!prev) break;
            path.unshift({
                id: prev.id, // from
                idNext: curr, // to
                weight: prev.linkWeight
            });
            curr = prev.id;
        }

        return path;
    }

    public solveCPP(): { lat: number, lon: number }[] {
        // 0. Prune islands
        this.pruneDisconnectedComponents();

        // 1. Identify odd nodes
        const oddNodes = this.getOddDegreeNodes();

        if (oddNodes.length > 0) {
            console.log(`Found ${oddNodes.length} odd degree nodes. Matching...`);

            const oddNodesSet = new Set(oddNodes);

            while (oddNodesSet.size > 0) {
                const step = oddNodesSet.values().next();
                if (step.done) break;
                const u = step.value;
                oddNodesSet.delete(u);

                let bestV: string | null = null;
                let minDist = Infinity;
                let bestPath: { id: string, idNext: string, weight: number }[] = [];

                for (const v of oddNodesSet) {
                    const foundPath = this.findPath(u, v);
                    if (foundPath.length > 0) {
                        let d = 0;
                        for (const edge of foundPath) {
                            d += edge.weight;
                        }
                        if (d < minDist) {
                            minDist = d;
                            bestV = v;
                            bestPath = foundPath;
                        }
                    }
                }

                if (bestV && bestPath.length > 0) {
                    oddNodesSet.delete(bestV);
                    console.log(`Matched ${u} with ${bestV} (dist: ${minDist})`);

                    // Add duplicate edges along the path
                    for (let k = 0; k < bestPath.length; k++) {
                        const edge = bestPath[k];
                        const ts = Date.now();
                        // Virtual edge
                        this.graph.addLink(edge.id, edge.idNext, { id: `virtual_${ts}_${k}`, weight: edge.weight, isVirtual: true, name: 'virtual' });
                        this.graph.addLink(edge.idNext, edge.id, { id: `virtual_${ts}_${k}_r`, weight: edge.weight, isVirtual: true, name: 'virtual' });
                    }
                } else {
                    console.error(`ERROR: Could not find match for odd node ${u}. PathFinder returned empty path or no candidate found.`);
                    // This is a critical failure state for Eulerian construction
                }
            }
        }

        // 4. Eulerian Circuit
        const edges: [string, string][] = [];
        this.graph.forEachLink((link: any) => {
            // Uniqueness check for undirected edges
            if (link.fromId < link.toId) {
                edges.push([link.fromId.toString(), link.toId.toString()] as [string, string]);
            }
        });

        // --- DEBUG START ---
        // Validate degrees
        const degreeMap = new Map<string, number>();
        for (const [u, v] of edges) {
            degreeMap.set(u, (degreeMap.get(u) || 0) + 1);
            degreeMap.set(v, (degreeMap.get(v) || 0) + 1);
        }
        const oddDegreeNodes = [];
        for (const [node, degree] of degreeMap.entries()) {
            if (degree % 2 !== 0) oddDegreeNodes.push({ node, degree });
        }
        if (oddDegreeNodes.length > 0) {
            console.error("DEBUG: Graph still has odd degree nodes after matching!", oddDegreeNodes);
            throw new Error(`Graph matching failed. ${oddDegreeNodes.length} nodes have odd degree. This indicates a bug in the matching algorithm or graph connectivity.`);
        } else {
            console.log("DEBUG: All nodes have even degree. Good.");
        }

        // Validate connectivity
        if (edges.length > 0) {
            const nodes = Array.from(degreeMap.keys());
            const adj = new Map<string, string[]>();
            for (const n of nodes) adj.set(n, []);
            for (const [u, v] of edges) {
                adj.get(u)?.push(v);
                adj.get(v)?.push(u);
            }
            const visited = new Set<string>();
            const stack = [nodes[0]];
            visited.add(nodes[0]);
            while (stack.length > 0) {
                const u = stack.pop()!;
                const neighbors = adj.get(u) || [];
                for (const v of neighbors) {
                    if (!visited.has(v)) {
                        visited.add(v);
                        stack.push(v);
                    }
                }
            }
            if (visited.size !== nodes.length) {
                const msg = `DEBUG: Graph is disconnected! Visited ${visited.size} of ${nodes.length} nodes.`;
                console.error(msg);
                throw new Error(msg);
            } else {
                console.log("DEBUG: Graph is fully connected. Good.");
            }
        }
        // --- DEBUG END ---

        try {
            // eulerian-trail expects edges as an array of [u, v]
            const trail = eulerianTrail({ edges });

            return trail.map((nodeId: string) => {
                const node = this.graph.getNode(nodeId);
                return { lat: node?.data.lat || 0, lon: node?.data.lon || 0 };
            });
        } catch (e: any) {
            console.error("Eulerian trail failed:", e);
            throw e;
        }
    }
}
