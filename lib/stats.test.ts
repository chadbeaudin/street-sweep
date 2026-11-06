import { buildCoverageCells, cellsToMiles, computeUniqueMiles, pointInPolygon, isBikingActivity, isCyclingActivity, isRunningActivity, isRunningActivityBroad, isModeActivity, isModeActivityBroad, computeRideRecords, computeActivityTotals, computeRideTypeBreakdown, computeYearDetail, isMountainBikeRide, ridesInMonth, summarizeRides } from './stats';

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

describe('stats.isCyclingActivity', () => {
    it('accepts everything isBikingActivity accepts', () => {
        expect(isCyclingActivity('Ride')).toBe(true);
        expect(isCyclingActivity('EBikeRide')).toBe(true);
        expect(isCyclingActivity('Handcycle')).toBe(true);
    });

    it('also accepts VirtualRide (indoor trainer) unlike isBikingActivity', () => {
        expect(isCyclingActivity('VirtualRide')).toBe(true);
        expect(isCyclingActivity('virtualride')).toBe(true);
        expect(isBikingActivity('VirtualRide')).toBe(false);
    });

    it('rejects non-cycling activity types', () => {
        expect(isCyclingActivity('Run')).toBe(false);
        expect(isCyclingActivity('Walk')).toBe(false);
        expect(isCyclingActivity('Hike')).toBe(false);
    });

    it('rejects undefined / empty', () => {
        expect(isCyclingActivity(undefined)).toBe(false);
        expect(isCyclingActivity('')).toBe(false);
    });
});

describe('stats.isRunningActivity', () => {
    it('accepts any on-foot sport type (case-insensitive)', () => {
        expect(isRunningActivity('Run')).toBe(true);
        expect(isRunningActivity('run')).toBe(true);
        expect(isRunningActivity('TrailRun')).toBe(true);
        expect(isRunningActivity('Walk')).toBe(true);
        expect(isRunningActivity('Hike')).toBe(true);
        expect(isRunningActivity('Snowshoe')).toBe(true);
    });

    it('rejects non-foot activity types, including cycling', () => {
        expect(isRunningActivity('Ride')).toBe(false);
        expect(isRunningActivity('EBikeRide')).toBe(false);
    });

    it('rejects virtual/treadmill runs (no real-world GPS)', () => {
        expect(isRunningActivity('VirtualRun')).toBe(false);
    });

    it('rejects undefined / empty', () => {
        expect(isRunningActivity(undefined)).toBe(false);
        expect(isRunningActivity('')).toBe(false);
    });
});

describe('stats.isRunningActivityBroad', () => {
    it('also accepts VirtualRun unlike isRunningActivity', () => {
        expect(isRunningActivityBroad('VirtualRun')).toBe(true);
        expect(isRunningActivityBroad('Run')).toBe(true);
        expect(isRunningActivity('VirtualRun')).toBe(false);
    });
});

describe('stats.isModeActivity / isModeActivityBroad', () => {
    it('cycling mode matches only bike types', () => {
        expect(isModeActivity('Ride', 'cycling')).toBe(true);
        expect(isModeActivity('Run', 'cycling')).toBe(false);
    });

    it('running mode matches any on-foot type, not just runs', () => {
        expect(isModeActivity('Run', 'running')).toBe(true);
        expect(isModeActivity('Walk', 'running')).toBe(true);
        expect(isModeActivity('Hike', 'running')).toBe(true);
        expect(isModeActivity('Ride', 'running')).toBe(false);
    });

    it('broad variants include the virtual counterpart for each mode', () => {
        expect(isModeActivityBroad('VirtualRide', 'cycling')).toBe(true);
        expect(isModeActivityBroad('VirtualRun', 'running')).toBe(true);
        expect(isModeActivityBroad('VirtualRun', 'cycling')).toBe(false);
        expect(isModeActivityBroad('VirtualRide', 'running')).toBe(false);
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

describe('stats.computeActivityTotals', () => {
    const MI = 1609.344;
    it('counts activities and sums elevation alongside the records', () => {
        const t = computeActivityTotals([10 * MI, 25 * MI], [100, 500], ['2024-05-01T10:00:00Z', '2024-05-02T10:00:00Z']);
        expect(t.activities).toBe(2);
        expect(t.distanceMiles).toBeCloseTo(35, 5);
        expect(t.elevationFeet).toBeCloseTo(600 * 3.28084, 3);
        expect(t.longestRideMiles).toBeCloseTo(25, 5);
        expect(t.biggestClimbFeet).toBeCloseTo(500 * 3.28084, 3);
        expect(t.activeDays).toBe(2);
    });
});

describe('stats.computeRideTypeBreakdown', () => {
    const MI = 1609.344;
    it('splits mountain bike rides from road and gravel combined', () => {
        const r = computeRideTypeBreakdown(
            ['MountainBikeRide', 'Ride', 'GravelRide', 'mountainbikeride', 'EBikeRide'],
            [10 * MI, 30 * MI, 20 * MI, 5 * MI, 15 * MI],
            [300, 100, 200, 100, 0]
        );
        expect(r.mountain.rides).toBe(2);
        expect(r.mountain.miles).toBeCloseTo(15, 5);
        expect(r.mountain.elevationFeet).toBeCloseTo(400 * 3.28084, 3);
        expect(r.roadGravel.rides).toBe(3);
        expect(r.roadGravel.miles).toBeCloseTo(65, 5);
        expect(r.roadGravel.elevationFeet).toBeCloseTo(300 * 3.28084, 3);
    });

    it('handles empty input', () => {
        expect(computeRideTypeBreakdown([], [], [])).toEqual({
            mountain: { rides: 0, miles: 0, elevationFeet: 0 },
            roadGravel: { rides: 0, miles: 0, elevationFeet: 0 },
            perYear: [],
        });
    });

    it('lets the bike frame type decide over the activity type (#136)', () => {
        const r = computeRideTypeBreakdown(
            ['Ride', 'MountainBikeRide', 'GravelRide', 'MountainBikeRide'],
            [10 * MI, 20 * MI, 5 * MI, 7 * MI],
            [0, 0, 0, 0],
            [],
            ['mtb', 'road', 'mtb', ''],
            new Map([['mtb', 1], ['road', 3]])
        );
        expect(r.mountain.rides).toBe(3);
        expect(r.mountain.miles).toBeCloseTo(22, 5);
        expect(r.roadGravel.rides).toBe(1);
        expect(r.roadGravel.miles).toBeCloseTo(20, 5);
    });

    it('splits miles per year (#136)', () => {
        const r = computeRideTypeBreakdown(
            ['MountainBikeRide', 'Ride', 'Ride', 'MountainBikeRide'],
            [10 * MI, 20 * MI, 5 * MI, 7 * MI],
            [0, 0, 0, 0],
            ['2016-05-01T00:00:00Z', '2016-06-01T00:00:00Z', '2015-01-01T00:00:00Z', ''],
        );
        expect(r.perYear.map(y => y.year)).toEqual([2015, 2016]);
        expect(r.perYear[0].mountainMiles).toBe(0);
        expect(r.perYear[0].roadGravelMiles).toBeCloseTo(5, 5);
        expect(r.perYear[1].mountainMiles).toBeCloseTo(10, 5);
        expect(r.perYear[1].roadGravelMiles).toBeCloseTo(20, 5);
    });
});

describe('stats.isMountainBikeRide (#136)', () => {
    const frames = new Map([['mtb', 1], ['road', 3], ['gravel', 5]]);
    it('uses the bike frame type when the bike is known', () => {
        expect(isMountainBikeRide('Ride', 'mtb', frames)).toBe(true);
        expect(isMountainBikeRide('GravelRide', 'mtb', frames)).toBe(true);
        expect(isMountainBikeRide('MountainBikeRide', 'road', frames)).toBe(false);
        expect(isMountainBikeRide('MountainBikeRide', 'gravel', frames)).toBe(false);
    });

    it('falls back to the activity type without a known bike', () => {
        expect(isMountainBikeRide('MountainBikeRide', '', frames)).toBe(true);
        expect(isMountainBikeRide('MountainBikeRide', 'unlooked', frames)).toBe(true);
        expect(isMountainBikeRide('Ride', '', frames)).toBe(false);
    });
});

describe('stats.computeYearDetail', () => {
    const ride = (id: number, start_date: string, miles: number, extra: Record<string, unknown> = {}) => ({
        id, name: `Ride ${id}`, start_date, distance: miles * 1609.344, total_elevation_gain: 100, type: 'Ride', ...extra,
    });

    it('lists the year\'s rides newest first', () => {
        const detail = computeYearDetail(2025, [ride(1, '2025-01-05T10:00:00Z', 10), ride(2, '2025-03-09T10:00:00Z', 20), ride(3, '2025-03-09T15:00:00Z', 5)]);
        expect(detail.rides.map(r => r.id)).toEqual([3, 2, 1]);
        expect(detail.rides[0]).toMatchObject({ name: 'Ride 3', date: '2025-03-09T15:00:00Z' });
        expect(detail.rides[0].miles).toBeCloseTo(5);
    });

    it('fills all twelve months and splits them by the bike', () => {
        const frames = new Map([['mtb', 1], ['road', 3]]);
        const { months } = computeYearDetail(2025, [
            ride(1, '2025-03-01T10:00:00Z', 10, { gear_id: 'mtb' }),
            ride(2, '2025-03-02T10:00:00Z', 20, { gear_id: 'road' }),
            ride(3, '2025-12-31T10:00:00Z', 5, { sport_type: 'MountainBikeRide' }),
        ], frames);
        expect(months).toHaveLength(12);
        expect(months[0]).toEqual({ month: 1, rides: 0, mountainMiles: 0, roadGravelMiles: 0 });
        expect(months[2].rides).toBe(2);
        expect(months[2].mountainMiles).toBeCloseTo(10);
        expect(months[2].roadGravelMiles).toBeCloseTo(20);
        expect(months[11].mountainMiles).toBeCloseTo(5);
    });

    it('returns an empty year without failing', () => {
        const detail = computeYearDetail(2025, []);
        expect(detail.rides).toEqual([]);
    });

    it('narrows to a month using the same bucket as the chart', () => {
        const { rides, months } = computeYearDetail(2025, [ride(1, '2025-03-31T23:30:00Z', 10), ride(2, '2025-04-01T00:30:00Z', 20)]);
        expect(ridesInMonth(rides, 3).map(r => r.id)).toEqual([1]);
        expect(ridesInMonth(rides, 4).map(r => r.id)).toEqual([2]);
        expect(ridesInMonth(rides, 3)).toHaveLength(months[2].rides);
        expect(ridesInMonth(rides, 5)).toEqual([]);
    });

    it('summarizes a set of rides', () => {
        const { rides } = computeYearDetail(2025, [ride(1, '2025-03-09T10:00:00Z', 20), ride(2, '2025-03-09T15:00:00Z', 5), ride(3, '2025-03-10T10:00:00Z', 10)]);
        const summary = summarizeRides(rides);
        expect(summary).toMatchObject({ rides: 3, activeDays: 2 });
        expect(summary.miles).toBeCloseTo(35);
        expect(summary.elevationFeet).toBeCloseTo(984.25, 1);
    });
});
