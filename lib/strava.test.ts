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
        stravaActivityStream: {
            findMany: jest.fn().mockResolvedValue([]),
            upsert: jest.fn().mockResolvedValue({}),
        },
        riddenRoadsTile: {
            deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
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
        (prisma.stravaActivityStream.findMany as jest.Mock).mockResolvedValue([]);
        (prisma.stravaActivityStream.upsert as jest.Mock).mockResolvedValue({});
        (prisma.riddenRoadsTile.deleteMany as jest.Mock).mockResolvedValue({ count: 0 });
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

    it('running mode keeps only Run/TrailRun activities and excludes rides', async () => {
        const activities = [
            mockActivity({ id: 1, type: 'Ride', total_elevation_gain: 100 }),
            mockActivity({ id: 2, type: 'Run', total_elevation_gain: 50 }),
            mockActivity({ id: 3, type: 'TrailRun', total_elevation_gain: 75 }),
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

        const result = await fetchCyclingRiddenRoads(creds, 'running');

        expect(result.riddenRoads.length).toBe(2); // Run + TrailRun, Ride excluded
        expect(result.totalCyclingActivities).toBe(2);
        expect(result.totalCyclingElevationGainMeters).toBe(125); // 50 + 75
    });

    it('cycling mode (default) excludes running activities', async () => {
        const activities = [
            mockActivity({ id: 1, type: 'Ride', total_elevation_gain: 100 }),
            mockActivity({ id: 2, type: 'Run', total_elevation_gain: 50 }),
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

        expect(result.riddenRoads.length).toBe(1);
        expect(result.totalCyclingActivities).toBe(1);
    });

    describe('expired activity cache', () => {
        const old = mockActivity({ id: 1, start_date: '2024-01-01T00:00:00Z' });
        const expired = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
        let listUrls: string[];

        beforeEach(() => {
            listUrls = [];
            (global.fetch as jest.Mock).mockImplementation((url: string) => {
                if (url.includes('oauth/token')) return Promise.resolve({ ok: true, json: async () => ({ access_token: 'token', scope: 'activity:read' }) });
                if (isDetailUrl(url)) return Promise.resolve({ ok: true, json: async () => ({ map: {} }) });
                if (url.includes('/athlete') && !url.includes('activities')) return Promise.resolve({ ok: true, json: async () => ({ id: 777 }) });
                if (url.includes('/activities')) {
                    listUrls.push(url);
                    const page1 = url.includes('page=1&');
                    return Promise.resolve({ ok: true, json: async () => (page1 ? [mockActivity({ id: 2, start_date: '2024-02-01T00:00:00Z' })] : []) });
                }
                throw new Error('unexpected fetch: ' + url);
            });
        });

        it('only fetches rides newer than the newest cached one and merges them in', async () => {
            (prisma.stravaActivityCache.findUnique as jest.Mock).mockResolvedValue({ athleteId: '777', activities: [old], syncedAt: expired });
            const result = await fetchCyclingRiddenRoads({ ...creds, refreshToken: 'incremental-refresh' });
            expect(listUrls.every(u => u.includes(`after=${Date.parse('2024-01-01T00:00:00Z') / 1000}`))).toBe(true);
            expect(result.riddenRoads).toHaveLength(2);
            const saved = (prisma.stravaActivityCache.upsert as jest.Mock).mock.calls[0][0].update.activities;
            expect(saved.map((a: any) => a.id)).toEqual([2, 1]);
        });

        it('does a full fetch when there is no cached history to build on', async () => {
            (prisma.stravaActivityCache.findUnique as jest.Mock).mockResolvedValue(null);
            await fetchCyclingRiddenRoads({ ...creds, refreshToken: 'full-refresh' });
            expect(listUrls.length).toBeGreaterThan(0);
            expect(listUrls.some(u => u.includes('after='))).toBe(false);
        });
    });

    describe('full-resolution tracks for recent rides', () => {
        const recentStart = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
        // A tight curve: a quarter circle of ~60m radius sampled every degree.
        const curve: [number, number][] = Array.from({ length: 91 }, (_, i) => {
            const a = (i * Math.PI) / 180;
            return [47.632 + (60 * Math.sin(a)) / 111320, -117.392 + (60 * (1 - Math.cos(a))) / (111320 * Math.cos(47.632 * Math.PI / 180))];
        });
        let streamUrls: string[];

        beforeEach(() => {
            streamUrls = [];
            (global.fetch as jest.Mock).mockImplementation((url: string) => {
                if (url.includes('oauth/token')) return Promise.resolve({ ok: true, json: async () => ({ access_token: 'token', scope: 'activity:read' }) });
                if (url.includes('/streams')) {
                    streamUrls.push(url);
                    if (url.includes('/activities/404/')) return Promise.resolve({ ok: false, status: 404, json: async () => ({}) });
                    return Promise.resolve({ ok: true, status: 200, json: async () => ({ latlng: { data: curve } }) });
                }
                if (isDetailUrl(url)) return Promise.resolve({ ok: true, json: async () => ({ map: {} }) });
                if (url.includes('/athlete') && !url.includes('activities')) return Promise.resolve({ ok: true, json: async () => ({ id: 555 }) });
                throw new Error('unexpected fetch: ' + url);
            });
        });

        it('fetches and stores the full track for a recent ride, and invalidates the tiles it crosses', async () => {
            (prisma.stravaActivityCache.findUnique as jest.Mock).mockResolvedValue({ athleteId: '555', activities: [mockActivity({ id: 10, start_date: recentStart })], syncedAt: new Date() });
            await fetchCyclingRiddenRoads({ ...creds, refreshToken: 'streams-refresh' });
            expect(streamUrls).toEqual([expect.stringContaining('/activities/10/streams?keys=latlng')]);
            const saved = (prisma.stravaActivityStream.upsert as jest.Mock).mock.calls[0][0].create;
            const decoded = require('@mapbox/polyline').decode(saved.polyline);
            expect(decoded).toHaveLength(curve.length);
            expect(prisma.riddenRoadsTile.deleteMany).toHaveBeenCalledWith({
                where: { athleteKey: { in: ['555', '555__running'] }, tile: { in: expect.arrayContaining(['2381,-5870']) } },
            });
        });

        it('never fetches tracks for historical rides', async () => {
            (prisma.stravaActivityCache.findUnique as jest.Mock).mockResolvedValue({ athleteId: '555', activities: [mockActivity({ id: 11, start_date: '2024-01-01T00:00:00Z' })], syncedAt: new Date() });
            await fetchCyclingRiddenRoads({ ...creds, refreshToken: 'streams-refresh' });
            expect(streamUrls).toEqual([]);
        });

        it('records a ride with no GPS stream as empty so it is not refetched', async () => {
            (prisma.stravaActivityCache.findUnique as jest.Mock).mockResolvedValue({ athleteId: '555', activities: [mockActivity({ id: 404, start_date: recentStart })], syncedAt: new Date() });
            await fetchCyclingRiddenRoads({ ...creds, refreshToken: 'streams-refresh' });
            expect((prisma.stravaActivityStream.upsert as jest.Mock).mock.calls[0][0].create.polyline).toBe('');
            expect(prisma.riddenRoadsTile.deleteMany).not.toHaveBeenCalled();
        });

        it('matches with the stored track only when fullResolution is requested', async () => {
            // Wide enough (300m radius) to clear the 250m stationary-ride filter.
            const wide: [number, number][] = curve.map(([lat, lon]) => [47.632 + (lat - 47.632) * 5, -117.392 + (lon + 117.392) * 5]);
            const stored = require('@mapbox/polyline').encode(wide);
            (prisma.stravaActivityCache.findUnique as jest.Mock).mockResolvedValue({ athleteId: '555', activities: [mockActivity({ id: 12, start_date: recentStart })], syncedAt: new Date() });
            (prisma.stravaActivityStream.findMany as jest.Mock).mockImplementation(async (args: any) =>
                args.select ? [{ activityId: '12' }] : [{ activityId: '12', polyline: stored }]);
            const browser = await fetchCyclingRiddenRoads({ ...creds, refreshToken: 'streams-refresh' });
            const worker = await fetchCyclingRiddenRoads({ ...creds, refreshToken: 'streams-refresh' }, 'cycling', { fullResolution: true });
            expect(browser.riddenRoads[0]).toEqual(require('@mapbox/polyline').decode(REAL_POLYLINE)); // the summary route line
            expect(worker.riddenRoads[0]).toHaveLength(wide.length);
        });
    });
});
