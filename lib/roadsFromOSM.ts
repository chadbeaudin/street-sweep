import { OSMWay } from '@/lib/types';

export function roadsFromOSM(data: { elements: any[] }): [number, number][][] {
    const nodeMap = new Map<number, [number, number]>();
    for (const el of data.elements) if (el.type === 'node') nodeMap.set(el.id, [el.lat, el.lon]);
    const roads: [number, number][][] = [];
    for (const el of data.elements) {
        if (el.type !== 'way') continue;
        const way = el as OSMWay;
        const hw = way.tags?.highway;
        // motorway stays excluded (illegal to cycle on); trunk/trunk_link/motorway_link are
        // legitimately routable (see lib/graph.ts routing penalties), so a genuinely ridden
        // one should still show as covered.
        if (hw === 'motorway') continue;
        let path: [number, number][];
        if (way.geometry) path = way.geometry.map(p => [p.lat, p.lon]);
        else { path = []; for (const nid of way.nodes ?? []) { const c = nodeMap.get(nid); if (c) path.push(c); } }
        if (path.length > 1) roads.push(path);
    }
    return roads;
}
