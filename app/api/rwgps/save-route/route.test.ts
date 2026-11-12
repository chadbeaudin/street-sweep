const mockJson = jest.fn();
jest.mock('next/server', () => ({ NextResponse: { json: mockJson } }));
jest.mock('next-auth', () => ({ getServerSession: jest.fn() }));
jest.mock('@/lib/auth', () => ({ authOptions: {} }));
jest.mock('@/lib/rwgps', () => ({
    ...jest.requireActual('@/lib/rwgps'),
    uploadRouteToRwgps: jest.fn(),
    deleteRwgpsRoute: jest.fn(),
}));

import { POST } from './route';
import { getServerSession } from 'next-auth';
import { uploadRouteToRwgps, deleteRwgpsRoute } from '@/lib/rwgps';

const mockedSession = getServerSession as jest.Mock;
// Shaped like a generated route: [lon, lat, elevation, construction] (#201).
const ROUTE = [[-117.42, 47.65, 600, 0], [-117.43, 47.66, 610, 1]];
const post = (body: unknown) => POST(new Request('http://localhost/api/test', { method: 'POST', body: JSON.stringify(body) }));

beforeEach(() => {
    // resetMocks clears the implementation between tests.
    mockJson.mockImplementation((data: any, init?: { status?: number }) => ({ status: init?.status ?? 200, _data: data }));
    mockedSession.mockResolvedValue({ user: { id: 'user-1' } });
});

describe('POST /api/rwgps/save-route (#190)', () => {
    const body = { route: ROUTE, name: 'Loop', accessToken: 'tok', oldRouteId: 5 };

    it('rejects a caller with no session before touching the upstream API', async () => {
        mockedSession.mockResolvedValue(null);
        expect((await post(body)).status).toBe(401);
        expect(uploadRouteToRwgps).not.toHaveBeenCalled();
        expect(deleteRwgpsRoute).not.toHaveBeenCalled();
    });

    it('rejects an old route id that is not a positive integer, so it cannot alter the upstream path', async () => {
        for (const oldRouteId of ['../users/current', '5', 5.5, -1, null]) {
            expect((await post({ ...body, oldRouteId })).status).toBe(400);
        }
        expect(uploadRouteToRwgps).not.toHaveBeenCalled();
        expect(deleteRwgpsRoute).not.toHaveBeenCalled();
    });

    it('uploads the replacement, then deletes the original', async () => {
        (uploadRouteToRwgps as jest.Mock).mockResolvedValue({ routeId: 8, routeUrl: 'u' });
        const res = await post(body) as any;
        expect(res._data).toEqual({ routeId: 8, routeUrl: 'u' });
        expect(deleteRwgpsRoute).toHaveBeenCalledWith('tok', 5);
    });

    it('still succeeds when deleting the original fails', async () => {
        (uploadRouteToRwgps as jest.Mock).mockResolvedValue({ routeId: 8, routeUrl: 'u' });
        (deleteRwgpsRoute as jest.Mock).mockRejectedValue(new Error('nope'));
        expect((await post(body) as any)._data.routeId).toBe(8);
    });
});
