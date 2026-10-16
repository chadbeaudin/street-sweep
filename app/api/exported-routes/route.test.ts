const mockJson = jest.fn();

jest.mock('next/server', () => ({ NextResponse: { json: mockJson } }));
jest.mock('next-auth', () => ({ getServerSession: jest.fn() }));
jest.mock('@/lib/auth', () => ({ authOptions: {} }));
jest.mock('@/lib/routeCredit', () => ({ recordExportedRoute: jest.fn() }));

import { POST } from './route';
import { getServerSession } from 'next-auth';
import { recordExportedRoute } from '@/lib/routeCredit';

const mockedSession = getServerSession as jest.Mock;
const mockedRecord = recordExportedRoute as jest.Mock;

function request(body: unknown): Request {
    return new Request('http://localhost/api/exported-routes', { method: 'POST', body: JSON.stringify(body) });
}

beforeEach(() => {
    mockedRecord.mockResolvedValue(undefined);
    mockJson.mockImplementation((data: unknown, init?: { status?: number }) => ({ status: init?.status ?? 200, _data: data }));
});

describe('POST /api/exported-routes', () => {
    it('records the route as [lat, lon] for the signed-in user', async () => {
        mockedSession.mockResolvedValue({ user: { id: 'user-1' } });
        const res = await POST(request({ route: [[-121.3, 44.05, 1000], [-121.29, 44.06]] })) as unknown as { _data: unknown };

        expect(mockedRecord).toHaveBeenCalledWith('user-1', [[44.05, -121.3], [44.06, -121.29]]);
        expect(res._data).toEqual({ recorded: true });
    });

    it('records nothing when signed out', async () => {
        mockedSession.mockResolvedValue(null);
        const res = await POST(request({ route: [[-121.3, 44.05], [-121.29, 44.06]] })) as unknown as { _data: unknown };

        expect(mockedRecord).not.toHaveBeenCalled();
        expect(res._data).toEqual({ recorded: false });
    });

    it('rejects a missing route', async () => {
        mockedSession.mockResolvedValue({ user: { id: 'user-1' } });
        const res = await POST(request({})) as unknown as { status: number };

        expect(res.status).toBe(400);
        expect(mockedRecord).not.toHaveBeenCalled();
    });
});
