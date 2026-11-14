const mockJson = jest.fn();
jest.mock('next/server', () => ({ NextResponse: { json: mockJson } }));
jest.mock('@/lib/rwgpsToken', () => ({ sessionUserId: jest.fn(), getRwgpsToken: jest.fn() }));

import { GET } from './route';
import { sessionUserId, getRwgpsToken } from '@/lib/rwgpsToken';

beforeEach(() => {
    mockJson.mockImplementation((data: unknown) => ({ status: 200, _data: data }));
});

describe('GET /api/rwgps/status (#194)', () => {
    it('reports connected without returning the token', async () => {
        (sessionUserId as jest.Mock).mockResolvedValue('u1');
        (getRwgpsToken as jest.Mock).mockResolvedValue('secret-tok');
        const res = await GET() as unknown as { _data: unknown };
        expect(res._data).toEqual({ connected: true });
        expect(JSON.stringify(res._data)).not.toContain('secret-tok');
    });

    it('reports disconnected for an anonymous caller or a user with no token', async () => {
        (sessionUserId as jest.Mock).mockResolvedValue(null);
        expect(((await GET()) as unknown as { _data: unknown })._data).toEqual({ connected: false });
        (sessionUserId as jest.Mock).mockResolvedValue('u1');
        (getRwgpsToken as jest.Mock).mockResolvedValue(null);
        expect(((await GET()) as unknown as { _data: unknown })._data).toEqual({ connected: false });
    });
});
