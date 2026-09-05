jest.mock('./prisma', () => ({
    prisma: {
        stravaActivityCache: {
            findUnique: jest.fn().mockResolvedValue(null),
            upsert: jest.fn().mockResolvedValue({}),
        },
    },
}));

import { fetchCyclingRiddenRoads } from './strava';
import { prisma } from './prisma';

const creds = { clientId: 'id', clientSecret: 'secret', refreshToken: 'refresh' };

// A real-world 3-point square, well over the 250m stationary-track floor.
const REAL_POLYLINE = 'gyxwF~qhbMcqDcqD';

function mockActivity(overrides: any) {
    return {
        id: overrides.id ?? 1,
        name: 'ride',
        map: { summary_polyline: REAL_POLYLINE },
        start_date: '2024-01-01T00:00:00Z',
        distance: 10000,
        total_elevation_gain: 100,
        type: 'Ride',
        ...overrides,
    };
}

describe('fetchCyclingRiddenRoads', () => {
    beforeEach(() => {
        (prisma.stravaActivityCache.findUnique as jest.Mock).mockResolvedValue(null);
        (prisma.stravaActivityCache.upsert as jest.Mock).mockResolvedValue({});
        global.fetch = jest.fn((url: string) => {
            if (url.includes('oauth/token')) {
                return Promise.resolve({ ok: true, json: async () => ({ access_token: 'token', scope: 'activity:read' }) });
            }
            if (url.includes('/athlete') && !url.includes('activities')) {
                return Promise.resolve({ ok: true, json: async () => ({ id: 999 }) });
            }
            throw new Error('unexpected fetch: ' + url);
        }) as any;
    });

    it('counts VirtualRide toward totalCyclingActivities/Elevation but not riddenRoads', async () => {
        const activities = [
            mockActivity({ id: 1, type: 'Ride', total_elevation_gain: 100 }),
            mockActivity({ id: 2, type: 'VirtualRide', total_elevation_gain: 50, map: { summary_polyline: REAL_POLYLINE } }),
        ];
        (global.fetch as jest.Mock).mockImplementation((url: string) => {
            if (url.includes('oauth/token')) return Promise.resolve({ ok: true, json: async () => ({ access_token: 'token', scope: 'activity:read' }) });
            if (url.includes('/athlete') && !url.includes('activities')) return Promise.resolve({ ok: true, json: async () => ({ id: 999 }) });
            if (url.includes('/activities')) {
                const isPage1 = url.includes('page=1&');
                return Promise.resolve({ ok: true, json: async () => (isPage1 ? activities : []) });
            }
            throw new Error('unexpected fetch: ' + url);
        });

        const result = await fetchCyclingRiddenRoads(creds);

        expect(result.riddenRoads.length).toBe(1); // VirtualRide excluded from real-world roads
        expect(result.totalCyclingActivities).toBe(2); // but counted in the broader total
        expect(result.totalCyclingElevationGainMeters).toBe(150); // 100 + 50
    });

    it('excludes non-cycling activities (Run/Hike) from both real and cycling totals', async () => {
        const activities = [
            mockActivity({ id: 1, type: 'Ride', total_elevation_gain: 100 }),
            mockActivity({ id: 2, type: 'Hike', total_elevation_gain: 500 }),
        ];
        (global.fetch as jest.Mock).mockImplementation((url: string) => {
            if (url.includes('oauth/token')) return Promise.resolve({ ok: true, json: async () => ({ access_token: 'token', scope: 'activity:read' }) });
            if (url.includes('/athlete') && !url.includes('activities')) return Promise.resolve({ ok: true, json: async () => ({ id: 999 }) });
            if (url.includes('/activities')) {
                const isPage1 = url.includes('page=1&');
                return Promise.resolve({ ok: true, json: async () => (isPage1 ? activities : []) });
            }
            throw new Error('unexpected fetch: ' + url);
        });

        const result = await fetchCyclingRiddenRoads(creds);

        expect(result.totalCyclingActivities).toBe(1);
        expect(result.totalCyclingElevationGainMeters).toBe(100);
    });
});
