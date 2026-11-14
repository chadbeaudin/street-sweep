const mockJson = jest.fn();
jest.mock('next/server', () => ({ NextResponse: { json: mockJson } }));
jest.mock('@/lib/rwgpsToken', () => ({ sessionUserId: jest.fn(), getRwgpsToken: jest.fn() }));
jest.mock('@/lib/rwgps', () => ({
    ...jest.requireActual('@/lib/rwgps'),
    listRoutes: jest.fn(),
    listCollections: jest.fn(),
}));

import { POST } from './route';
import { sessionUserId, getRwgpsToken } from '@/lib/rwgpsToken';
import { listRoutes, listCollections } from '@/lib/rwgps';

const mockedSession = sessionUserId as jest.Mock;
const post = () => POST();

beforeEach(() => {
    // resetMocks clears the implementation between tests.
    mockJson.mockImplementation((data: any, init?: { status?: number }) => ({ status: init?.status ?? 200, _data: data }));
    mockedSession.mockResolvedValue('user-1');
    (getRwgpsToken as jest.Mock).mockResolvedValue('tok');
});

describe('POST /api/rwgps/library (#190)', () => {
    it('rejects a caller with no session before touching the upstream API', async () => {
        mockedSession.mockResolvedValue(null);
        expect((await post()).status).toBe(401);
        expect(listRoutes).not.toHaveBeenCalled();
    });

    it('rejects a signed-in caller with no stored token (#194)', async () => {
        (getRwgpsToken as jest.Mock).mockResolvedValue(null);
        expect((await post()).status).toBe(401);
        expect(listRoutes).not.toHaveBeenCalled();
    });

    it('returns the library tree for a signed-in caller', async () => {
        const route = { id: 1, name: 'A', distance: 1000, url: 'u1' };
        (listRoutes as jest.Mock).mockResolvedValue([route]);
        (listCollections as jest.Mock).mockResolvedValue([]);
        const res = await post() as any;
        expect(res._data).toEqual({ collections: [], uncategorized: [route] });
    });
});
