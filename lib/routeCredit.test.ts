import polyline from '@mapbox/polyline';

jest.mock('./prisma', () => ({
    prisma: {
        user: { findUnique: jest.fn() },
        account: { findFirst: jest.fn() },
        exportedRoute: { findMany: jest.fn(), update: jest.fn(), create: jest.fn() },
        stravaActivityCache: { findUnique: jest.fn() },
        stravaActivityStream: { findUnique: jest.fn() },
        stravaActivityDetail: { findUnique: jest.fn() },
    },
}));
jest.mock('./tokenCrypto', () => ({ decryptToken: jest.fn() }));
jest.mock('./strava', () => ({ getStravaAccessToken: jest.fn() }));

import { appendCredit, creditMatchingActivities, recordExportedRoute, routeCoverage, CREDIT_TEXT } from './routeCredit';
import { prisma } from './prisma';
import { getStravaAccessToken } from './strava';
import { decryptToken } from './tokenCrypto';

type LatLon = [number, number];

// ~1.1 km straight east-west street.
const street: LatLon[] = [[44.05, -121.30], [44.05, -121.286]];
// Same street, plus a separate 1.1 km leg north the route never asked for.
const rideOverStreet: LatLon[] = [[44.05, -121.30], [44.05, -121.286], [44.06, -121.286]];
// Parallel street ~220 m north.
const parallelRide: LatLon[] = [[44.052, -121.30], [44.052, -121.286]];

const exportedAt = new Date('2026-10-10T12:00:00Z');
const fetchMock = jest.fn();

function activity(id: number, start: string, track: LatLon[]) {
    return { id, name: 'Ride', start_date: start, type: 'Ride', map: { summary_polyline: polyline.encode(track) } };
}

function setup({
    credit = true,
    scope = 'read,activity:read,activity:write',
    activities = [activity(1, '2026-10-11T15:00:00Z', rideOverStreet)],
    description = 'Morning loop',
}: { credit?: boolean; scope?: string; activities?: ReturnType<typeof activity>[]; description?: string | null } = {}) {
    (prisma.user.findUnique as jest.Mock).mockResolvedValue({ id: 'user-1', athleteId: '42', creditRoutesOnStrava: credit });
    (prisma.account.findFirst as jest.Mock).mockResolvedValue({ refresh_token: 'enc', scope });
    (prisma.exportedRoute.findMany as jest.Mock).mockImplementation(({ where }) =>
        Promise.resolve(where.creditedActivityId === null ? [{ id: 'r1', polyline: polyline.encode(street), createdAt: exportedAt }] : []));
    (prisma.stravaActivityCache.findUnique as jest.Mock).mockResolvedValue({ activities });
    fetchMock.mockImplementation((_url: string, init?: RequestInit) =>
        Promise.resolve({ ok: true, json: async () => (init?.method === 'PUT' ? {} : { description }) }));
}

const putCalls = () => fetchMock.mock.calls.filter(([, init]) => init?.method === 'PUT');

beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = fetchMock as unknown as typeof fetch;
    (getStravaAccessToken as jest.Mock).mockResolvedValue('access-123');
    (decryptToken as jest.Mock).mockReturnValue('refresh-123');
    (prisma.stravaActivityStream.findUnique as jest.Mock).mockResolvedValue(null);
    (prisma.stravaActivityDetail.findUnique as jest.Mock).mockResolvedValue(null);
});

describe('routeCoverage', () => {
    it('is full when the ride follows the route, even with extra riding', () => {
        expect(routeCoverage(street, rideOverStreet)).toBe(1);
    });

    it('is zero for a ride on a parallel street', () => {
        expect(routeCoverage(street, parallelRide)).toBe(0);
    });

    it('counts only the part of the route that was ridden', () => {
        const halfRide: LatLon[] = [[44.05, -121.30], [44.05, -121.293]];
        expect(routeCoverage(street, halfRide)).toBeGreaterThan(0.45);
        expect(routeCoverage(street, halfRide)).toBeLessThan(0.6);
    });
});

describe('appendCredit', () => {
    it('adds the credit after an existing description', () => {
        expect(appendCredit('Windy')).toBe(`Windy\n\n${CREDIT_TEXT}`);
    });

    it('uses the credit alone for an empty description', () => {
        expect(appendCredit(null)).toBe(CREDIT_TEXT);
        expect(appendCredit('  ')).toBe(CREDIT_TEXT);
    });

    it('returns null when the credit is already there', () => {
        expect(appendCredit(`Windy\n\n${CREDIT_TEXT}`)).toBeNull();
    });
});

describe('recordExportedRoute', () => {
    it('stores the route as an encoded polyline for the user', async () => {
        await recordExportedRoute('user-1', street);
        expect(prisma.exportedRoute.create).toHaveBeenCalledWith({ data: { userId: 'user-1', polyline: polyline.encode(street) } });
    });
});

describe('creditMatchingActivities', () => {
    it('appends the credit to a ride after the export that covers the route', async () => {
        setup();
        expect(await creditMatchingActivities('user-1')).toBe(1);

        expect(putCalls()).toHaveLength(1);
        const [url, init] = putCalls()[0];
        expect(url).toBe('https://www.strava.com/api/v3/activities/1');
        expect(JSON.parse(init.body)).toEqual({ description: `Morning loop\n\n${CREDIT_TEXT}` });
        expect(getStravaAccessToken).toHaveBeenCalledWith({ refreshToken: 'refresh-123' });
        expect(prisma.exportedRoute.update).toHaveBeenCalledWith({ where: { id: 'r1' }, data: { creditedActivityId: '1' } });
    });

    it('credits a ride that cut the route short but still covered most of it', async () => {
        const firstSixtyPercent: LatLon[] = [[44.05, -121.30], [44.05, -121.2916]];
        setup({ activities: [activity(1, '2026-10-11T15:00:00Z', firstSixtyPercent)] });
        expect(await creditMatchingActivities('user-1')).toBe(1);
    });

    it('ignores a ride that only shared a short piece of the route', async () => {
        const firstThird: LatLon[] = [[44.05, -121.30], [44.05, -121.2953]];
        setup({ activities: [activity(1, '2026-10-11T15:00:00Z', firstThird)] });
        expect(await creditMatchingActivities('user-1')).toBe(0);
    });

    it('prefers the stored full GPS track over the summary line', async () => {
        setup({ activities: [activity(1, '2026-10-11T15:00:00Z', parallelRide)] });
        (prisma.stravaActivityStream.findUnique as jest.Mock).mockResolvedValue({ polyline: polyline.encode(rideOverStreet) });
        expect(await creditMatchingActivities('user-1')).toBe(1);
    });

    it('ignores rides that do not follow the route', async () => {
        setup({ activities: [activity(1, '2026-10-11T15:00:00Z', parallelRide)] });
        expect(await creditMatchingActivities('user-1')).toBe(0);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('ignores rides from before the export or more than a week after', async () => {
        setup({ activities: [activity(1, '2026-10-09T15:00:00Z', rideOverStreet), activity(2, '2026-10-18T15:00:00Z', rideOverStreet)] });
        expect(await creditMatchingActivities('user-1')).toBe(0);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('credits only the earliest matching ride', async () => {
        setup({ activities: [activity(2, '2026-10-12T15:00:00Z', rideOverStreet), activity(1, '2026-10-11T15:00:00Z', rideOverStreet)] });
        expect(await creditMatchingActivities('user-1')).toBe(1);
        expect(putCalls().map(([url]) => url)).toEqual(['https://www.strava.com/api/v3/activities/1']);
    });

    it('does nothing when the user turned crediting off', async () => {
        setup({ credit: false });
        expect(await creditMatchingActivities('user-1')).toBe(0);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('does nothing without Strava write permission', async () => {
        setup({ scope: 'read,activity:read' });
        expect(await creditMatchingActivities('user-1')).toBe(0);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('does not edit a description that already has the credit', async () => {
        setup({ description: `Morning loop\n\n${CREDIT_TEXT}` });
        expect(await creditMatchingActivities('user-1')).toBe(1);
        expect(putCalls()).toHaveLength(0);
    });

    it('leaves the route open for a later ride when the Strava update fails', async () => {
        setup();
        fetchMock.mockImplementation((_url: string, init?: RequestInit) =>
            Promise.resolve(init?.method === 'PUT' ? { ok: false } : { ok: true, json: async () => ({ description: '' }) }));
        expect(await creditMatchingActivities('user-1')).toBe(0);
        expect(prisma.exportedRoute.update).not.toHaveBeenCalled();
    });
});
