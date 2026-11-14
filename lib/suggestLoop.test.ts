import { StreetGraph } from './graph';
import { OverpassResponse } from './types';
import { haversineM } from './geometry';
import { offsetPoint, scoreLoop, planLoop, loopReachM, measureGainM } from './suggestLoop';

// 41×41 street grid at ~200 m spacing (8 km square) with the start in the middle.
const N = 41, STEP = 0.0018, LAT0 = 47.6, LON0 = -117.4;
const START = { lat: LAT0 + STEP * 20, lon: LON0 + STEP * 20 * 1.48 };
const coord = (i: number, j: number) => ({ lat: LAT0 + STEP * i, lon: LON0 + STEP * j * 1.48 });
const id = (i: number, j: number) => 1 + i * N + j;

function buildGrid(): StreetGraph {
    const ways: unknown[] = [];
    let w = 1;
    const way = (cells: [number, number][]) => ({ type: 'way', id: w++, nodes: cells.map(([i, j]) => id(i, j)), geometry: cells.map(([i, j]) => coord(i, j)), tags: { highway: 'residential' } });
    for (let i = 0; i < N; i++) ways.push(way(Array.from({ length: N }, (_, j) => [i, j] as [number, number])));
    for (let j = 0; j < N; j++) ways.push(way(Array.from({ length: N }, (_, i) => [i, j] as [number, number])));
    const g = new StreetGraph();
    g.buildFromOSM({ version: 0.6, generator: 'test', osm3s: { timestamp_osm_base: '', copyright: '' }, elements: ways } as OverpassResponse);
    return g;
}

// A 150 m hill 2.5 km north of the start.
const HILL = offsetPoint(START, 2500, 0);
const elevation = ([lon, lat]: [number, number]) => 150 * Math.exp(-((haversineM(lat, lon, HILL.lat, HILL.lon) / 900) ** 2));
const elevationsFor = async (pts: [number, number][]) => pts.map(elevation);

describe('scoreLoop (#80)', () => {
    const target = { distanceM: 20_000, gainM: 300 };
    it('ranks distance first', () => {
        expect(scoreLoop({ distanceM: 20_000, gainM: 450, unriddenFraction: 0 }, target))
            .toBeLessThan(scoreLoop({ distanceM: 26_000, gainM: 300, unriddenFraction: 0 }, target));
    });

    it('penalises climbing too much more than climbing too little', () => {
        expect(scoreLoop({ distanceM: 20_000, gainM: 200, unriddenFraction: 0 }, target))
            .toBeLessThan(scoreLoop({ distanceM: 20_000, gainM: 400, unriddenFraction: 0 }, target));
    });

    it('matches the usual climbing before chasing unridden streets', () => {
        // Real candidates from a 34 km / 384 m usual ride (#80).
        const usual = { distanceM: 34_000, gainM: 384 };
        expect(scoreLoop({ distanceM: 35_300, gainM: 394, unriddenFraction: 0.68 }, usual))
            .toBeLessThan(scoreLoop({ distanceM: 34_000, gainM: 213, unriddenFraction: 0.93 }, usual));
    });

    it('prefers unridden streets when distance and climbing tie', () => {
        expect(scoreLoop({ distanceM: 20_000, gainM: 300, unriddenFraction: 0.9 }, target))
            .toBeLessThan(scoreLoop({ distanceM: 20_000, gainM: 300, unriddenFraction: 0.1 }, target));
    });
});

describe('planLoop (#80)', () => {
    it('returns a loop from the start close to the target distance', async () => {
        const loop = (await planLoop(buildGrid(), START, { distanceM: 8_000, gainM: 0 }, new Map(), elevationsFor))!;
        const [first, last] = [loop.path[0], loop.path[loop.path.length - 1]];
        expect(haversineM(first[0], first[1], START.lat, START.lon)).toBeLessThan(150);
        expect(haversineM(last[0], last[1], START.lat, START.lon)).toBeLessThan(150);
        expect(Math.abs(loop.distanceM - 8_000) / 8_000).toBeLessThan(0.15);
    });

    it('keeps away from the hill when the usual ride is flat, and climbs it when the usual ride climbs', async () => {
        const flat = (await planLoop(buildGrid(), START, { distanceM: 8_000, gainM: 0 }, new Map(), elevationsFor))!;
        const hilly = (await planLoop(buildGrid(), START, { distanceM: 8_000, gainM: 140 }, new Map(), elevationsFor))!;
        expect(flat.gainM).toBeLessThan(30);
        expect(hilly.gainM).toBeGreaterThan(100);
    });

    it('prefers a direction of unridden streets over an equal ridden one', async () => {
        const g = buildGrid();
        // Everything east of the start is already ridden.
        g.graph.forEachLink((link: any) => {
            if (g.graph.getNode(link.fromId)!.data.lon > START.lon + 0.001) link.data.isRidden = true;
        });
        const loop = (await planLoop(g, START, { distanceM: 8_000, gainM: 0 }, g.buildRiddenPenaltyMap(4), async pts => pts.map(() => 0)))!;
        expect(loop.unriddenFraction).toBeGreaterThan(0.8);
    });

    it('sizes the street graph to cover the farthest corner it might try', () => {
        expect(loopReachM({ distanceM: 39_000, gainM: 0 })).toBeCloseTo(16_000, -2);
    });
});

describe('measureGainM (#80)', () => {
    it("measures a ride's climbing from map elevations along it", async () => {
        const overHill: [number, number][] = [[START.lat, START.lon], [HILL.lat, HILL.lon], [START.lat, START.lon]];
        expect(await measureGainM(overHill, elevationsFor)).toBeGreaterThan(140);
    });
});
