import { buildCoverageCells, cellsToMiles, computeUniqueMiles, pointInPolygon, isBikingActivity, computeRideRecords } from './stats';

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

describe('stats.isBikingActivity', () => {
    it('accepts known bike sport types (case-insensitive)', () => {
        expect(isBikingActivity('Ride')).toBe(true);
        expect(isBikingActivity('ride')).toBe(true);
        expect(isBikingActivity('EBikeRide')).toBe(true);
        expect(isBikingActivity('ebikeride')).toBe(true);
        expect(isBikingActivity('GravelRide')).toBe(true);
        expect(isBikingActivity('MountainBikeRide')).toBe(true);
        expect(isBikingActivity('Handcycle')).toBe(true);
    });

    it('rejects non-biking activity types', () => {
        expect(isBikingActivity('Run')).toBe(false);
        expect(isBikingActivity('Walk')).toBe(false);
        expect(isBikingActivity('Swim')).toBe(false);
        expect(isBikingActivity('Hike')).toBe(false);
        expect(isBikingActivity('AlpineSki')).toBe(false);
        expect(isBikingActivity('Workout')).toBe(false);
    });

    it('rejects virtual/indoor rides (fictional GPS coordinates)', () => {
        expect(isBikingActivity('VirtualRide')).toBe(false);
        expect(isBikingActivity('virtualride')).toBe(false);
    });

    it('rejects undefined / empty (must be explicitly biking)', () => {
        expect(isBikingActivity(undefined)).toBe(false);
        expect(isBikingActivity('')).toBe(false);
    });
});

describe('stats.computeRideRecords', () => {
    const MI = 1609.344;
    it('totals distance, finds records, counts active days and years', () => {
        const r = computeRideRecords(
            [10 * MI, 25 * MI, 25 * MI],
            [100, 500, 300],           // meters climbed
            ['2024-05-01T10:00:00Z', '2024-05-01T15:00:00Z', '2025-06-02T08:00:00Z']
        );
        expect(r.totalDistanceMiles).toBeCloseTo(60, 5);
        expect(r.longestRideMiles).toBeCloseTo(25, 5);
        expect(r.biggestClimbFeet).toBeCloseTo(500 * 3.28084, 3);
        expect(r.activeDays).toBe(2); // two rides same day count once
        expect(r.ridesPerYear).toEqual([
            { year: 2024, rides: 2, miles: 35 },
            { year: 2025, rides: 1, miles: 25 },
        ]);
    });

    it('handles empty input', () => {
        const r = computeRideRecords([], [], []);
        expect(r.totalDistanceMiles).toBe(0);
        expect(r.longestRideMiles).toBe(0);
        expect(r.activeDays).toBe(0);
        expect(r.ridesPerYear).toEqual([]);
    });
});
