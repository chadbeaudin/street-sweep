// @ts-ignore
import createGraph, { Graph } from 'ngraph.graph';
// @ts-ignore
import path from 'ngraph.path';
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
        this.graph = createGraph();
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
            if (node.links && node.links.length % 2 !== 0) {
                oddNodes.push(node.id.toString());
            }
        });
        return oddNodes;
    }

    public solveCPP(): { lat: number, lon: number }[] {
        // 1. Identify odd nodes
        const oddNodes = this.getOddDegreeNodes();

        if (oddNodes.length > 0) {
            console.log(`Found ${oddNodes.length} odd degree nodes. Matching...`);

            // 2. Greedy Matching
            // Calculate necessary distances using A*
            const pathFinder = path.aStar(this.graph, {
                distance(fromNode: any, toNode: any, link: any) {
                    return link.data.weight;
                }
            });

            const oddNodesSet = new Set(oddNodes);

            while (oddNodesSet.size > 0) {
                const step = oddNodesSet.values().next();
                if (step.done) break;
                const u = step.value;
                oddNodesSet.delete(u);

                let bestV = null;
                let minDist = Infinity;
                let bestPath: any[] = [];

                for (const v of oddNodesSet) {
                    const foundPath = pathFinder.find(u, v);
                    if (foundPath.length > 0) {
                        let d = 0;
                        for (let k = 1; k < foundPath.length; k++) {
                            const n1 = foundPath[k - 1].data;
                            const n2 = foundPath[k].data;
                            d += this.haversine(n1.lat, n1.lon, n2.lat, n2.lon);
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
                    // pathFinder.find returns array of nodes from TO to FROM (reverse).
                    // We need to iterate it.
                    for (let k = 0; k < bestPath.length - 1; k++) {
                        const nA = bestPath[k];
                        const nB = bestPath[k + 1];
                        // Re-calculate dist or assume simple. Recalc for safety.
                        const dist = this.haversine(nA.data.lat, nA.data.lon, nB.data.lat, nB.data.lon);
                        const ts = Date.now();
                        this.graph.addLink(nA.id, nB.id, { id: `virtual_${ts}_${k}`, weight: dist, isVirtual: true, name: 'virtual' });
                        this.graph.addLink(nB.id, nA.id, { id: `virtual_${ts}_${k}_r`, weight: dist, isVirtual: true, name: 'virtual' });
                    }
                } else {
                    console.warn(`Could not find match for odd node ${u}`);
                }
            }
        }

        // 4. Eulerian Circuit
        const edges: [string, string][] = [];
        this.graph.forEachLink((link: any) => {
            if (link.fromId < link.toId) {
                edges.push([link.fromId.toString(), link.toId.toString()] as [string, string]);
            }
        });

        try {
            // eulerian-trail expects edges as an array of [u, v]
            const trail = eulerianTrail({ edges });

            return trail.map((nodeId: string) => {
                const node = this.graph.getNode(nodeId);
                return { lat: node?.data.lat || 0, lon: node?.data.lon || 0 };
            });
        } catch (e) {
            console.error("Eulerian trail failed:", e);
            return [];
        }
    }
}
