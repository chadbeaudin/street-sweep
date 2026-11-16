jest.mock('./strava', () => ({ fetchCyclingRiddenRoads: jest.fn(), fetchGearFrameTypes: jest.fn() }));
jest.mock('./nominatim', () => ({
    reverseGeocode: jest.fn(async () => ({ city: null, county: null, state: null, country: null })),
    searchCityPolygon: jest.fn(),
}));
jest.mock('./overpass', () => ({ fetchOSMData: jest.fn() }));
jest.mock('./prisma', () => ({ prisma: { statsCache: { upsert: jest.fn() } } }));

import { recomputeStats } from './statsCompute';
import { fetchCyclingRiddenRoads, fetchGearFrameTypes } from './strava';
import { reverseGeocode } from './nominatim';
import { prisma } from './prisma';

const MI = 1609.344;
const track: [number, number][] = [[44, -121], [44.01, -121]];

function persisted() {
    const call = (prisma.statsCache.upsert as jest.Mock).mock.calls[0][0];
    return call.create.stats;
}

beforeEach(() => {
    jest.clearAllMocks();
    (fetchGearFrameTypes as jest.Mock).mockResolvedValue(new Map([['mtb', 1], ['road', 3]]));
    (fetchCyclingRiddenRoads as jest.Mock).mockResolvedValue({
        riddenRoads: [track, track, track],
        activityElevations: [500, 100, 200],
        activityTypes: ['MountainBikeRide', 'Ride', 'GravelRide'],
        activityGearIds: ['', '', ''],
        activityDistances: [10 * MI, 30 * MI, 20 * MI],
        activityStartDates: ['2026-01-01T00:00:00Z', '2026-01-02T00:00:00Z', '2026-01-03T00:00:00Z'],
        totalCyclingActivities: 3,
        totalCyclingElevationGainMeters: 800,
        virtualDistances: [],
        virtualElevations: [],
        virtualStartDates: [],
    });
});

describe('recomputeStats ride type breakdown', () => {
    it('persists a mountain vs road/gravel breakdown for cycling', async () => {
        await recomputeStats('42', undefined, 'cycling');
        const { rideTypeBreakdown } = persisted();
        expect(rideTypeBreakdown.mountain.rides).toBe(1);
        expect(rideTypeBreakdown.mountain.miles).toBeCloseTo(10, 5);
        expect(rideTypeBreakdown.roadGravel.rides).toBe(2);
        expect(rideTypeBreakdown.roadGravel.miles).toBeCloseTo(50, 5);
    });

    it('omits the breakdown for running', async () => {
        await recomputeStats('42', undefined, 'running');
        expect(persisted().rideTypeBreakdown).toBeUndefined();
        expect(fetchGearFrameTypes).not.toHaveBeenCalled();
    });

    it('classifies by bike frame type, per year too (#136)', async () => {
        (fetchCyclingRiddenRoads as jest.Mock).mockResolvedValueOnce({
            riddenRoads: [track, track],
            activityElevations: [0, 0],
            activityTypes: ['Ride', 'MountainBikeRide'],
            activityGearIds: ['mtb', 'road'],
            activityDistances: [10 * MI, 30 * MI],
            activityStartDates: ['2015-01-01T00:00:00Z', '2026-01-02T00:00:00Z'],
            totalCyclingActivities: 2,
            totalCyclingElevationGainMeters: 0,
            virtualDistances: [],
            virtualElevations: [],
            virtualStartDates: [],
        });
        await recomputeStats('42', { refreshToken: 'r' }, 'cycling');
        expect(fetchGearFrameTypes).toHaveBeenCalledWith({ refreshToken: 'r' }, ['mtb', 'road']);
        const { rideTypeBreakdown } = persisted();
        expect(rideTypeBreakdown.mountain.rides).toBe(1);
        expect(rideTypeBreakdown.perYear).toEqual([
            { year: 2015, mountainMiles: expect.closeTo(10, 5), roadGravelMiles: 0, mountainHours: 0, roadGravelHours: 0 },
            { year: 2026, mountainMiles: 0, roadGravelMiles: expect.closeTo(30, 5), mountainHours: 0, roadGravelHours: 0 },
        ]);
    });
});

describe('recomputeStats IRL vs virtual split', () => {
    it('splits totals and reports combined records', async () => {
        (fetchCyclingRiddenRoads as jest.Mock).mockResolvedValueOnce({
            riddenRoads: [track, track],
            activityElevations: [100, 300],
            activityTypes: ['Ride', 'Ride'],
            activityGearIds: ['', ''],
            activityDistances: [20 * MI, 30 * MI],
            activityStartDates: ['2026-01-01T00:00:00Z', '2026-01-02T00:00:00Z'],
            totalCyclingActivities: 3,
            totalCyclingElevationGainMeters: 900,
            virtualDistances: [40 * MI],
            virtualElevations: [500],
            virtualStartDates: ['2026-01-02T18:00:00Z'],
            activityMovingTimes: [2 * 3600, 3 * 3600],
            virtualMovingTimes: [3600],
        });
        await recomputeStats('42', undefined, 'cycling');
        const stats = persisted();
        expect(stats.split.irl).toMatchObject({ activities: 2, distanceMiles: expect.closeTo(50, 5), longestRideMiles: expect.closeTo(30, 5), activeDays: 2 });
        expect(stats.split.irl.elevationFeet).toBeCloseTo(400 * 3.28084, 3);
        expect(stats.split.virtual).toMatchObject({ activities: 1, distanceMiles: expect.closeTo(40, 5), activeDays: 1 });
        expect(stats.totalActivities).toBe(3);
        expect(stats.totalDistanceMiles).toBeCloseTo(90, 5);
        expect(stats.longestRideMiles).toBeCloseTo(40, 5);
        expect(stats.biggestClimbFeet).toBeCloseTo(500 * 3.28084, 3);
        expect(stats.activeDays).toBe(2); // the virtual ride shares a day with an IRL ride
        expect(stats.ridesPerYear).toEqual([{ year: 2026, rides: 2, miles: expect.closeTo(50, 5), hours: expect.closeTo(5, 5) }]);
        expect(stats.virtualPerYear).toEqual([{ year: 2026, rides: 1, miles: expect.closeTo(40, 5), hours: expect.closeTo(1, 5) }]);
        // Moving time (#230): outdoor and virtual add up to the headline total.
        expect(stats.totalHours).toBeCloseTo(6, 5);
        expect(stats.split.irl.hours).toBeCloseTo(5, 5);
        expect(stats.split.virtual.hours).toBeCloseTo(1, 5);
    });
});

describe('recomputeStats places along a ride (#233)', () => {
    const place = (city: string | null, county: string) => ({ city, county, state: 'Utah', country: 'United States' });
    // Starts in the city, ends well north of it: the midpoint is in neither place.
    const outOfTown: [number, number][] = [[40.76, -111.89], [40.89, -111.95], [41.0, -112.0]];
    const inTown: [number, number][] = [[40.76, -111.89], [40.761, -111.888]];

    beforeEach(() => {
        (reverseGeocode as jest.Mock).mockImplementation(async (lat: number) =>
            lat < 40.8 ? place('Salt Lake City', 'Salt Lake County') : lat < 40.95 ? place(null, 'Davis County') : place('Farmington', 'Davis County'));
        (fetchCyclingRiddenRoads as jest.Mock).mockResolvedValue({
            riddenRoads: [outOfTown, inTown],
            activityElevations: [0, 0], activityTypes: ['Ride', 'Ride'], activityGearIds: ['', ''],
            activityDistances: [20 * MI, 1 * MI], activityStartDates: ['2026-11-06T00:00:00Z', '2026-11-07T00:00:00Z'],
            totalCyclingActivities: 2, totalCyclingElevationGainMeters: 0,
            virtualDistances: [], virtualElevations: [], virtualStartDates: [], activityMovingTimes: [], virtualMovingTimes: [],
        });
    });

    it('credits a ride to every city and county it passes through, not just its midpoint', async () => {
        await recomputeStats('42', undefined, 'cycling');
        const { bikingStats } = persisted();
        expect(bikingStats.cities.map((c: { name: string }) => c.name)).toEqual(['Farmington', 'Salt Lake City']);
        expect(bikingStats.counties.map((c: { name: string }) => c.name)).toEqual(['Davis County', 'Salt Lake County']);
    });

    it('counts a ride once per city, and looks each bucket up once across rides', async () => {
        await recomputeStats('42', undefined, 'cycling');
        const { cities } = persisted();
        expect(cities.find((c: { name: string }) => c.name === 'Salt Lake City').activityCount).toBe(2);
        expect(cities.find((c: { name: string }) => c.name === 'Farmington').activityCount).toBe(1);
        expect(reverseGeocode).toHaveBeenCalledTimes(3); // both rides share the Salt Lake City bucket
    });
});
