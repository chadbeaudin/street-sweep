const mockJson = jest.fn();
jest.mock('next/server', () => ({ NextResponse: { json: mockJson } }));
jest.mock('@/lib/rwgpsToken', () => ({ sessionUserId: jest.fn(), getRwgpsToken: jest.fn() }));
jest.mock('@/lib/rwgps', () => ({
    ...jest.requireActual('@/lib/rwgps'),
    uploadRouteToRwgps: jest.fn(),
}));

import { POST } from './route';
import { sessionUserId, getRwgpsToken } from '@/lib/rwgpsToken';
import { uploadRouteToRwgps } from '@/lib/rwgps';

const mockedSession = sessionUserId as jest.Mock;
// Shaped like a generated route: [lon, lat, elevation, construction] (#201).
const ROUTE = [[-117.42, 47.65, 600, 0], [-117.43, 47.66, 610, 1]];
const post = (body: unknown) => POST(new Request('http://localhost/api/test', { method: 'POST', body: JSON.stringify(body) }));

beforeEach(() => {
    // resetMocks clears the implementation between tests.
    mockJson.mockImplementation((data: any, init?: { status?: number }) => ({ status: init?.status ?? 200, _data: data }));
    mockedSession.mockResolvedValue('user-1');
    (getRwgpsToken as jest.Mock).mockResolvedValue('tok');
});

describe('POST /api/export/rwgps (#190)', () => {
    const body = { route: ROUTE, name: 'Loop' };

    it('rejects a caller with no session before touching the upstream API', async () => {
        mockedSession.mockResolvedValue(null);
        expect((await post(body)).status).toBe(401);
        expect(uploadRouteToRwgps).not.toHaveBeenCalled();
    });

    it('rejects a signed-in caller with no stored token (#194)', async () => {
        (getRwgpsToken as jest.Mock).mockResolvedValue(null);
        expect((await post(body)).status).toBe(401);
        expect(uploadRouteToRwgps).not.toHaveBeenCalled();
    });

    it('rejects a malformed or oversized route', async () => {
        expect((await post({ ...body, route: 'nope' })).status).toBe(400);
        expect((await post({ ...body, route: Array(20_001).fill([0, 0]) })).status).toBe(400);
        expect(uploadRouteToRwgps).not.toHaveBeenCalled();
    });

    it('uploads the route as GPX for a signed-in caller', async () => {
        (uploadRouteToRwgps as jest.Mock).mockResolvedValue({ routeId: 7, routeUrl: 'u' });
        const res = await post(body) as any;
        expect(res._data).toEqual({ routeId: 7, routeUrl: 'u' });
        expect(uploadRouteToRwgps).toHaveBeenCalledWith('tok', expect.stringContaining('<name>Loop</name>'), 'Loop');
    });
});
