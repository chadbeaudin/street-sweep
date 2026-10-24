jest.mock('./strava', () => ({ fetchCyclingRiddenRoads: jest.fn() }));
jest.mock('./nominatim', () => ({
    reverseGeocode: jest.fn(async () => ({ city: null, county: null, state: null, country: null })),
    searchCityPolygon: jest.fn(),
}));
jest.mock('./overpass', () => ({ fetchOSMData: jest.fn() }));
jest.mock('./prisma', () => ({ prisma: { statsCache: { upsert: jest.fn() } } }));

import { recomputeStats } from './statsCompute';
import { fetchCyclingRiddenRoads } from './strava';
import { prisma } from './prisma';

const MI = 1609.344;
const track: [number, number][] = [[44, -121], [44.01, -121]];

function persisted() {
    const call = (prisma.statsCache.upsert as jest.Mock).mock.calls[0][0];
    return call.create.stats;
}

beforeEach(() => {
    jest.clearAllMocks();
    (fetchCyclingRiddenRoads as jest.Mock).mockResolvedValue({
        riddenRoads: [track, track, track],
        activityElevations: [500, 100, 200],
        activityTypes: ['MountainBikeRide', 'Ride', 'GravelRide'],
        activityDistances: [10 * MI, 30 * MI, 20 * MI],
        activityStartDates: ['2026-01-01T00:00:00Z', '2026-01-02T00:00:00Z', '2026-01-03T00:00:00Z'],
        totalCyclingActivities: 3,
        totalCyclingElevationGainMeters: 800,
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
    });
});
