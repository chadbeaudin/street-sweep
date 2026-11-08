jest.mock('./strava', () => ({ fetchCyclingRiddenRoads: jest.fn(), fetchGearFrameTypes: jest.fn() }));
jest.mock('./nominatim', () => ({
    reverseGeocode: jest.fn(async () => ({ city: null, county: null, state: null, country: null })),
    searchCityPolygon: jest.fn(),
}));
jest.mock('./overpass', () => ({ fetchOSMData: jest.fn() }));
jest.mock('./prisma', () => ({ prisma: { statsCache: { upsert: jest.fn() } } }));

import { recomputeStats } from './statsCompute';
import { fetchCyclingRiddenRoads, fetchGearFrameTypes } from './strava';
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
            { year: 2015, mountainMiles: expect.closeTo(10, 5), roadGravelMiles: 0 },
            { year: 2026, mountainMiles: 0, roadGravelMiles: expect.closeTo(30, 5) },
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
        expect(stats.ridesPerYear).toEqual([{ year: 2026, rides: 2, miles: expect.closeTo(50, 5) }]);
        expect(stats.virtualPerYear).toEqual([{ year: 2026, rides: 1, miles: expect.closeTo(40, 5) }]);
    });
});
