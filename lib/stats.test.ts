import { buildCoverageCells, cellsToMiles, computeUniqueMiles, pointInPolygon } from './stats';

describe('stats.buildCoverageCells', () => {
    it('returns no cells for empty input', () => {
        expect(buildCoverageCells([]).size).toBe(0);
    });

    it('counts a single short ride as roughly its length in cells', () => {
        // 1km east of a starting point
        const start: [number, number] = [40.0, -75.0];
        const oneKmEastDeg = 1000 / (111320 * Math.cos(40 * Math.PI / 180));
        const ride: [number, number][] = [start, [start[0], start[1] + oneKmEastDeg]];
        const cells = buildCoverageCells([ride]);
        // 15m cells in a 1000m segment → ~66 cells
        expect(cells.size).toBeGreaterThan(50);
        expect(cells.size).toBeLessThan(80);
    });

    it('deduplicates overlapping rides on the same road', () => {
        const start: [number, number] = [40.0, -75.0];
        const oneKmEastDeg = 1000 / (111320 * Math.cos(40 * Math.PI / 180));
        const ride: [number, number][] = [start, [start[0], start[1] + oneKmEastDeg]];
        const single = buildCoverageCells([ride]).size;
        const dozen = buildCoverageCells([ride, ride, ride, ride, ride, ride, ride, ride, ride, ride, ride, ride]).size;
        expect(dozen).toBe(single);
    });

    it('converts cells to miles in the right ballpark', () => {
        const start: [number, number] = [40.0, -75.0];
        // 1 mile east (5280 ft ≈ 1609m)
        const oneMileEastDeg = 1609.344 / (111320 * Math.cos(40 * Math.PI / 180));
        const ride: [number, number][] = [start, [start[0], start[1] + oneMileEastDeg]];
        const miles = computeUniqueMiles([ride]);
        expect(miles).toBeGreaterThan(0.85);
        expect(miles).toBeLessThan(1.15);
    });

    it('cellsToMiles is monotonic', () => {
        expect(cellsToMiles(0)).toBe(0);
        expect(cellsToMiles(100)).toBeGreaterThan(cellsToMiles(50));
    });
});

describe('stats.pointInPolygon', () => {
    const square: [number, number][] = [
        [0, 0], [0, 1], [1, 1], [1, 0], [0, 0]
    ];
    it('detects interior points', () => {
        expect(pointInPolygon(0.5, 0.5, square)).toBe(true);
    });
    it('rejects exterior points', () => {
        expect(pointInPolygon(2, 2, square)).toBe(false);
        expect(pointInPolygon(-1, 0.5, square)).toBe(false);
    });
});
