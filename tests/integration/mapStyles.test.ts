/**
 * Live check that every map style's tile URL serves real map tiles (#175).
 * Run with: npm run test:integration
 */
import { MAP_STYLES } from '@/lib/mapStyles';

// Two neighboring land tiles over the US, so even the US-only style has content in both.
const TILES = [{ z: 3, x: 1, y: 3 }, { z: 3, x: 2, y: 3 }];

const tileUrl = (template: string, t: { z: number; x: number; y: number }) => template
    .replace('{s}', 'a')
    .replace('{z}', String(t.z)).replace('{x}', String(t.x)).replace('{y}', String(t.y))
    .replace('{r}', '');

describe('map style tiles', () => {
    it.each(MAP_STYLES.map(s => [s.id, s.url]))('%s serves real, distinct tiles', async (_, template) => {
        const bodies = await Promise.all(TILES.map(async t => {
            // OSM's tile policy requires a referer and user agent.
            const res = await fetch(tileUrl(template, t), { headers: { Referer: 'http://localhost:3888/', 'User-Agent': 'StreetSweep integration test' } });
            expect(res.status).toBe(200);
            expect(res.headers.get('content-type')).toMatch(/^image\//);
            return Buffer.from(await res.arrayBuffer()).toString('base64');
        }));
        // A provider that wants a key answers 200 with the same placeholder image for every tile.
        expect(bodies[0]).not.toBe(bodies[1]);
    }, 20000);
});
