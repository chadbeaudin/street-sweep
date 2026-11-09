import { ROAD_ENCODING, decodeRoads, encodeRoads } from './roadEncoding';

const roads: [number, number][][] = [
    [[47.6588123, -117.4260456], [47.6591234, -117.4255678], [47.6602345, -117.4249789]],
    [[40.7802171, -111.9071326], [40.7803, -111.9071]],
];

describe('road encoding (#181)', () => {
    it('round-trips every road to within about a meter', () => {
        const back = decodeRoads(encodeRoads(roads));
        expect(back).toHaveLength(roads.length);
        back.forEach((road, i) => {
            expect(road).toHaveLength(roads[i].length);
            road.forEach(([lat, lon], j) => {
                expect(Math.abs(lat - roads[i][j][0])).toBeLessThanOrEqual(0.0000051);
                expect(Math.abs(lon - roads[i][j][1])).toBeLessThanOrEqual(0.0000051);
            });
        });
    });

    it('is several times smaller than the JSON arrays it replaces', () => {
        expect(JSON.stringify(encodeRoads(roads)).length * 3).toBeLessThan(JSON.stringify(roads).length);
    });

    it('handles no roads', () => {
        expect(decodeRoads(encodeRoads([]))).toEqual([]);
    });

    it('names the format the client asks for', () => {
        expect(ROAD_ENCODING).toBe('polyline5');
    });
});
