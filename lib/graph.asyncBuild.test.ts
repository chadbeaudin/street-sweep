import { StreetGraph } from './graph';
import { OverpassResponse } from './types';

// A grid big enough that building it takes well over one 50 ms slice.
function bigGrid(n: number): OverpassResponse {
    const ways: unknown[] = [];
    const id = (i: number, j: number) => 1 + i * n + j;
    const coord = (i: number, j: number) => ({ lat: 47.6 + i * 0.0005, lon: -117.4 + j * 0.0007 });
    let w = 1;
    for (let i = 0; i < n; i++) {
        const cells = Array.from({ length: n }, (_, j) => [i, j] as const);
        ways.push({ type: 'way', id: w++, nodes: cells.map(([a, b]) => id(a, b)), geometry: cells.map(([a, b]) => coord(a, b)), tags: { highway: 'residential' } });
        const col = Array.from({ length: n }, (_, k) => [k, i] as const);
        ways.push({ type: 'way', id: w++, nodes: col.map(([a, b]) => id(a, b)), geometry: col.map(([a, b]) => coord(a, b)), tags: { highway: 'residential' } });
    }
    return { version: 0.6, generator: 'test', osm3s: { timestamp_osm_base: '', copyright: '' }, elements: ways } as OverpassResponse;
}

describe('buildFromOSMAsync (#216)', () => {
    it('builds the same graph as the synchronous build', async () => {
        const data = bigGrid(30);
        const sync = new StreetGraph();
        sync.buildFromOSM(data);
        const async = new StreetGraph();
        await async.buildFromOSMAsync(data);
        expect(async.graph.getNodesCount()).toBe(sync.graph.getNodesCount());
        expect(async.graph.getLinksCount()).toBe(sync.graph.getLinksCount());
    });

    it('lets other requests run while a large graph builds', async () => {
        const data = bigGrid(220);
        const events: string[] = [];
        const ticker = setInterval(() => events.push('other work'), 10);
        const g = new StreetGraph();
        await g.buildFromOSMAsync(data);
        events.push('built');
        clearInterval(ticker);
        expect(events.indexOf('other work')).toBeGreaterThanOrEqual(0);
        expect(events.indexOf('other work')).toBeLessThan(events.indexOf('built'));
    });

    it('getCachedGraphAsync builds once and then serves the cached graph', async () => {
        const data = bigGrid(10);
        const bbox = { south: 47.6, west: -117.4, north: 47.61, east: -117.39 };
        const first = await StreetGraph.getCachedGraphAsync(bbox, data);
        expect(await StreetGraph.getCachedGraphAsync(bbox, data)).toBe(first);
        expect(StreetGraph.getCachedGraph(bbox, data)).toBe(first);
    });
});
