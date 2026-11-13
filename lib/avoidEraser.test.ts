import { eraseFromPolylines } from './avoidEraser';

// ~111m per 0.001° of latitude; lines run north-south along lon -117.
const LON = -117;
const at = (lat: number): [number, number] => [lat, LON];

describe('eraseFromPolylines', () => {
    it('returns the same array when the eraser misses every line', () => {
        const roads = [[at(47.0), at(47.001)]];
        expect(eraseFromPolylines(roads, [47.0, -116.99], 20)).toBe(roads);
    });

    it('splits a line where the eraser cuts through its middle', () => {
        const roads = [[at(47.0), at(47.002)]];
        const result = eraseFromPolylines(roads, at(47.001), 20);

        expect(result).toHaveLength(2);
        const [south, north] = result;
        expect(south[0]).toEqual(at(47.0));
        expect(north[1]).toEqual(at(47.002));
        // Cut points sit ~20m (~0.00018°) either side of the eraser center.
        expect(south[1][0]).toBeCloseTo(47.001 - 20 / 110_540, 6);
        expect(north[0][0]).toBeCloseTo(47.001 + 20 / 110_540, 6);
    });

    it('trims the end of a line without splitting it', () => {
        const roads = [[at(47.0), at(47.001), at(47.002)]];
        const result = eraseFromPolylines(roads, at(47.002), 20);

        expect(result).toHaveLength(1);
        expect(result[0].slice(0, 2)).toEqual([at(47.0), at(47.001)]);
        expect(result[0][2][0]).toBeCloseTo(47.002 - 20 / 110_540, 6);
    });

    it('drops vertices that fall inside the eraser', () => {
        const roads = [[at(47.0), at(47.0009), at(47.001), at(47.0011), at(47.002)]];
        const result = eraseFromPolylines(roads, at(47.001), 20);

        expect(result).toHaveLength(2);
        expect(result.flat().some(p => p[0] === 47.0009 || p[0] === 47.001 || p[0] === 47.0011)).toBe(false);
    });

    it('removes a line entirely covered by the eraser', () => {
        const roads = [[at(47.0), at(47.00005)], [at(47.01), at(47.011)]];
        const result = eraseFromPolylines(roads, at(47.0), 20);

        expect(result).toEqual([[at(47.01), at(47.011)]]);
    });
});
