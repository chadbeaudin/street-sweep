const mockJson = jest.fn();
jest.mock('next/server', () => ({ NextResponse: { json: mockJson } }));
jest.mock('@/lib/rwgpsToken', () => ({ sessionUserId: jest.fn(), getRwgpsToken: jest.fn() }));
jest.mock('@/lib/rwgps', () => ({
    ...jest.requireActual('@/lib/rwgps'),
    fetchRouteGpx: jest.fn(),
}));

import { POST } from './route';
import { sessionUserId, getRwgpsToken } from '@/lib/rwgpsToken';
import { fetchRouteGpx } from '@/lib/rwgps';
import * as metrics from '@/lib/metrics';

const mockedSession = sessionUserId as jest.Mock;
const ROUTE = [[-117.42, 47.65, 600], [-117.43, 47.66, 610]];
const post = (body: unknown) => POST(new Request('http://localhost/api/test', { method: 'POST', body: JSON.stringify(body) }));

beforeEach(() => {
    // resetMocks clears the implementation between tests.
    mockJson.mockImplementation((data: any, init?: { status?: number }) => ({ status: init?.status ?? 200, _data: data }));
    mockedSession.mockResolvedValue('user-1');
    (getRwgpsToken as jest.Mock).mockResolvedValue('tok');
});

const GPX = '<gpx><trk><trkseg><trkpt lat="47.65" lon="-117.42"><ele>600</ele></trkpt><trkpt lat="47.66" lon="-117.43"><ele>610</ele></trkpt></trkseg></trk></gpx>';

describe('POST /api/rwgps/load-route (#190)', () => {
    it('rejects a caller with no session before touching the upstream API', async () => {
        mockedSession.mockResolvedValue(null);
        expect((await post({ routeId: 5 })).status).toBe(401);
        expect(fetchRouteGpx).not.toHaveBeenCalled();
    });

    it('rejects a route id that is not a positive integer, so it cannot alter the upstream path', async () => {
        for (const routeId of ['../users/current', '5', 5.5, -1, 0, null]) {
            expect((await post({ routeId })).status).toBe(400);
        }
        expect(fetchRouteGpx).not.toHaveBeenCalled();
    });

    it('loads and parses the route for a signed-in caller, counting it as a library import (#117)', async () => {
        const counted = jest.spyOn(metrics, 'incrementMetric');
        (fetchRouteGpx as jest.Mock).mockResolvedValue({ gpx: GPX, name: 'Loop' });
        const res = await post({ routeId: 5 }) as any;
        expect(fetchRouteGpx).toHaveBeenCalledWith('tok', 5);
        expect(res._data.routeName).toBe('Loop');
        expect(res._data.coordinates).toHaveLength(2);
        expect(counted).toHaveBeenCalledWith('usage.import.library');
    });
});
