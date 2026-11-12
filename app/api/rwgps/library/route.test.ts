const mockJson = jest.fn();
jest.mock('next/server', () => ({ NextResponse: { json: mockJson } }));
jest.mock('next-auth', () => ({ getServerSession: jest.fn() }));
jest.mock('@/lib/auth', () => ({ authOptions: {} }));
jest.mock('@/lib/rwgps', () => ({
    ...jest.requireActual('@/lib/rwgps'),
    listRoutes: jest.fn(),
    listCollections: jest.fn(),
}));

import { POST } from './route';
import { getServerSession } from 'next-auth';
import { listRoutes, listCollections } from '@/lib/rwgps';

const mockedSession = getServerSession as jest.Mock;
const ROUTE = [[-117.42, 47.65, 600], [-117.43, 47.66, 610]];
const post = (body: unknown) => POST(new Request('http://localhost/api/test', { method: 'POST', body: JSON.stringify(body) }));

beforeEach(() => {
    // resetMocks clears the implementation between tests.
    mockJson.mockImplementation((data: any, init?: { status?: number }) => ({ status: init?.status ?? 200, _data: data }));
    mockedSession.mockResolvedValue({ user: { id: 'user-1' } });
});

describe('POST /api/rwgps/library (#190)', () => {
    it('rejects a caller with no session before touching the upstream API', async () => {
        mockedSession.mockResolvedValue(null);
        expect((await post({ accessToken: 'tok' })).status).toBe(401);
        expect(listRoutes).not.toHaveBeenCalled();
    });

    it('rejects a missing access token', async () => {
        expect((await post({})).status).toBe(400);
        expect(listRoutes).not.toHaveBeenCalled();
    });

    it('returns the library tree for a signed-in caller', async () => {
        const route = { id: 1, name: 'A', distance: 1000, url: 'u1' };
        (listRoutes as jest.Mock).mockResolvedValue([route]);
        (listCollections as jest.Mock).mockResolvedValue([]);
        const res = await post({ accessToken: 'tok' }) as any;
        expect(res._data).toEqual({ collections: [], uncategorized: [route] });
    });
});
