import { roadsFromOSM } from './roadsFromOSM';

describe('roadsFromOSM', () => {
    const node = (id: number, lat: number, lon: number) => ({ type: 'node', id, lat, lon });
    const way = (id: number, nodes: number[], highway: string) => ({ type: 'way', id, nodes, tags: { highway } });

    it('excludes motorway (illegal to cycle on)', () => {
        const data = {
            elements: [node(1, 0, 0), node(2, 0, 1), way(10, [1, 2], 'motorway')],
        };
        expect(roadsFromOSM(data)).toEqual([]);
    });

    it('includes trunk, trunk_link, and motorway_link — a genuinely ridden highway should show as covered', () => {
        const data = {
            elements: [
                node(1, 0, 0), node(2, 0, 1),
                node(3, 0, 2), node(4, 0, 3),
                node(5, 0, 4), node(6, 0, 5),
                way(10, [1, 2], 'trunk'),
                way(11, [3, 4], 'trunk_link'),
                way(12, [5, 6], 'motorway_link'),
            ],
        };
        expect(roadsFromOSM(data)).toHaveLength(3);
    });
});
