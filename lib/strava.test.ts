jest.mock('./prisma', () => ({
    prisma: {
        stravaActivityCache: {
            findUnique: jest.fn().mockResolvedValue(null),
            upsert: jest.fn().mockResolvedValue({}),
        },
        stravaActivityDetail: {
            findMany: jest.fn().mockResolvedValue([]),
            upsert: jest.fn().mockResolvedValue({}),
        },
    },
}));

import { fetchCyclingRiddenRoads, forceSyncStravaActivities } from './strava';
import { prisma } from './prisma';

const creds = { clientId: 'id', clientSecret: 'secret', refreshToken: 'refresh' };

// A real-world 3-point square, well over the 250m stationary-track floor.
const REAL_POLYLINE = 'gyxwF~qhbMcqDcqD';
// A different real-world track (also well over the 250m floor), used to prove
// detail polyline took precedence over summary_polyline when both are available.
const DETAIL_POLYLINE = require('@mapbox/polyline').encode([
    [47.65, -117.42], [47.6520, -117.4220], [47.6540, -117.4240],
]);

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

// Strava's detail endpoint is `/activities/{id}` (path segment, no query
// string); the list endpoint is `/athlete/activities?page=...` (query string,
// no trailing path segment) -- these patterns never overlap, so tests can
// distinguish them reliably.
function isDetailUrl(url: string): boolean {
    return /\/activities\/\d+$/.test(url);
}

describe('fetchCyclingRiddenRoads', () => {
    beforeEach(() => {
        (prisma.stravaActivityCache.findUnique as jest.Mock).mockResolvedValue(null);
        (prisma.stravaActivityCache.upsert as jest.Mock).mockResolvedValue({});
        (prisma.stravaActivityDetail.findMany as jest.Mock).mockResolvedValue([]);
        (prisma.stravaActivityDetail.upsert as jest.Mock).mockResolvedValue({});
        global.fetch = jest.fn((url: string) => {
            if (url.includes('oauth/token')) {
                return Promise.resolve({ ok: true, json: async () => ({ access_token: 'token', scope: 'activity:read' }) });
            }
            if (isDetailUrl(url)) {
                return Promise.resolve({ ok: true, json: async () => ({ map: {} }) }); // no full-res track -- keep summary
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
            if (isDetailUrl(url)) return Promise.resolve({ ok: true, json: async () => ({ map: {} }) });
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
            if (isDetailUrl(url)) return Promise.resolve({ ok: true, json: async () => ({ map: {} }) });
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

    it('forceSync followed by fetchCyclingRiddenRoads refreshes the token once for the list pull, plus once more for detail backfill', async () => {
        const activities = [mockActivity({ id: 1 })];
        let tokenCalls = 0;
        let activitiesCalls = 0;
        (global.fetch as jest.Mock).mockImplementation((url: string) => {
            if (url.includes('oauth/token')) {
                tokenCalls++;
                return Promise.resolve({ ok: true, json: async () => ({ access_token: 'token', scope: 'activity:read' }) });
            }
            if (isDetailUrl(url)) {
                return Promise.resolve({ ok: true, json: async () => ({ map: {} }) });
            }
            if (url.includes('/athlete') && !url.includes('activities')) {
                return Promise.resolve({ ok: true, json: async () => ({ id: 12345 }) });
            }
            if (url.includes('/activities')) {
                activitiesCalls++;
                const isPage1 = url.includes('page=1&');
                return Promise.resolve({ ok: true, json: async () => (isPage1 ? activities : []) });
            }
            throw new Error('unexpected fetch: ' + url);
        });

        // Simulate the /api/strava/activities route: forceSync writes a fresh
        // Postgres cache row, then fetchCyclingRiddenRoads should read that
        // row back instead of re-hitting Strava's list endpoint.
        const now = new Date();
        (prisma.stravaActivityCache.upsert as jest.Mock).mockImplementation(async ({ create }: any) => {
            (prisma.stravaActivityCache.findUnique as jest.Mock).mockResolvedValue({ athleteId: create.athleteId, activities: create.activities, syncedAt: now });
            return {};
        });

        await forceSyncStravaActivities({ ...creds, refreshToken: 'force-sync-refresh' });
        await fetchCyclingRiddenRoads({ ...creds, refreshToken: 'force-sync-refresh' });

        expect(tokenCalls).toBe(2); // forceSync's own refresh, plus one more for detail backfill (id 1 isn't cached yet)
        expect(activitiesCalls).toBe(2); // one full pagination sweep (page 1 + empty page 2), not two
    });

    it('backfills a not-yet-cached real ride\'s detail polyline into StravaActivityDetail', async () => {
        const activities = [mockActivity({ id: 42 })];
        (global.fetch as jest.Mock).mockImplementation((url: string) => {
            if (url.includes('oauth/token')) return Promise.resolve({ ok: true, json: async () => ({ access_token: 'token', scope: 'activity:read' }) });
            if (isDetailUrl(url)) return Promise.resolve({ ok: true, json: async () => ({ map: { polyline: DETAIL_POLYLINE } }) });
            if (url.includes('/athlete') && !url.includes('activities')) return Promise.resolve({ ok: true, json: async () => ({ id: 999 }) });
            if (url.includes('/activities')) {
                const isPage1 = url.includes('page=1&');
                return Promise.resolve({ ok: true, json: async () => (isPage1 ? activities : []) });
            }
            throw new Error('unexpected fetch: ' + url);
        });

        await fetchCyclingRiddenRoads(creds);

        expect(prisma.stravaActivityDetail.upsert).toHaveBeenCalledWith(expect.objectContaining({
            where: { activityId: '42' },
            create: expect.objectContaining({ activityId: '42', athleteId: '999', polyline: DETAIL_POLYLINE }),
        }));
    });

    it('prefers a cached detail polyline over summary_polyline for the ridden-road trace', async () => {
        const activities = [mockActivity({ id: 7 })];
        (prisma.stravaActivityDetail.findMany as jest.Mock).mockResolvedValue([
            { activityId: '7', polyline: DETAIL_POLYLINE },
        ]);
        (global.fetch as jest.Mock).mockImplementation((url: string) => {
            if (url.includes('oauth/token')) return Promise.resolve({ ok: true, json: async () => ({ access_token: 'token', scope: 'activity:read' }) });
            if (isDetailUrl(url)) throw new Error('should not re-fetch detail for an already-cached activity');
            if (url.includes('/athlete') && !url.includes('activities')) return Promise.resolve({ ok: true, json: async () => ({ id: 999 }) });
            if (url.includes('/activities')) {
                const isPage1 = url.includes('page=1&');
                return Promise.resolve({ ok: true, json: async () => (isPage1 ? activities : []) });
            }
            throw new Error('unexpected fetch: ' + url);
        });

        const result = await fetchCyclingRiddenRoads(creds);

        const summaryDecoded = require('@mapbox/polyline').decode(REAL_POLYLINE);
        const detailDecoded = require('@mapbox/polyline').decode(DETAIL_POLYLINE);
        expect(result.riddenRoads[0]).toEqual(detailDecoded);
        expect(result.riddenRoads[0]).not.toEqual(summaryDecoded);
        expect(prisma.stravaActivityDetail.upsert).not.toHaveBeenCalled(); // already cached -- no backfill needed
    });
});
