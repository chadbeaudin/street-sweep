const mockJson = jest.fn();

jest.mock('next/server', () => ({ NextResponse: { json: mockJson } }));
jest.mock('next-auth', () => ({ getServerSession: jest.fn() }));
jest.mock('@/lib/auth', () => ({ authOptions: {} }));
jest.mock('@/lib/accountDeletion', () => ({ deleteAccount: jest.fn() }));
jest.mock('@/lib/prisma', () => ({
    prisma: { user: { findUnique: jest.fn(), update: jest.fn() }, account: { findFirst: jest.fn() } },
}));

import { DELETE, GET, PATCH } from './route';
import { prisma } from '@/lib/prisma';
import { getServerSession } from 'next-auth';
import { deleteAccount } from '@/lib/accountDeletion';

const mockedSession = getServerSession as jest.Mock;
const mockedDeleteAccount = deleteAccount as jest.Mock;

beforeEach(() => {
    jest.clearAllMocks();
    mockedDeleteAccount.mockResolvedValue(undefined);
    mockJson.mockImplementation((data: unknown, init?: { status?: number }) => ({ status: init?.status ?? 200, _data: data }));
});

describe('DELETE /api/account', () => {
    it('rejects requests without a session', async () => {
        mockedSession.mockResolvedValue(null);
        const res = await DELETE() as unknown as { status: number };

        expect(res.status).toBe(401);
        expect(mockedDeleteAccount).not.toHaveBeenCalled();
    });

    it("deletes the signed-in user's own account", async () => {
        mockedSession.mockResolvedValue({ user: { id: 'user-1', name: 'Rider' } });
        const res = await DELETE() as unknown as { status: number; _data: unknown };

        expect(mockedDeleteAccount).toHaveBeenCalledWith('user-1');
        expect(res.status).toBe(200);
        expect(res._data).toEqual({ deleted: true });
    });

    it('returns 500 when deletion fails', async () => {
        mockedSession.mockResolvedValue({ user: { id: 'user-1' } });
        mockedDeleteAccount.mockRejectedValue(new Error('db down'));
        jest.spyOn(console, 'error').mockImplementation(() => {});

        const res = await DELETE() as unknown as { status: number };
        expect(res.status).toBe(500);
    });
});

describe('GET /api/account', () => {
    it('rejects requests without a session', async () => {
        mockedSession.mockResolvedValue(null);
        const res = await GET() as unknown as { status: number };
        expect(res.status).toBe(401);
    });

    it('reports the credit setting and whether Strava granted write access', async () => {
        mockedSession.mockResolvedValue({ user: { id: 'user-1' } });
        (prisma.user.findUnique as jest.Mock).mockResolvedValue({ creditRoutesOnStrava: true });
        (prisma.account.findFirst as jest.Mock).mockResolvedValue({ scope: 'read,activity:read,activity:write' });

        const res = await GET() as unknown as { _data: unknown };
        expect(res._data).toEqual({ hasStravaAccount: true, creditRoutesOnStrava: true, canWriteToStrava: true });
    });

    it('reports no write access for an older read-only Strava connection', async () => {
        mockedSession.mockResolvedValue({ user: { id: 'user-1' } });
        (prisma.user.findUnique as jest.Mock).mockResolvedValue({ creditRoutesOnStrava: true });
        (prisma.account.findFirst as jest.Mock).mockResolvedValue({ scope: 'activity:read read' });

        const res = await GET() as unknown as { _data: { canWriteToStrava: boolean } };
        expect(res._data.canWriteToStrava).toBe(false);
    });

    it('reports no Strava account for a non-Strava sign-in', async () => {
        mockedSession.mockResolvedValue({ user: { id: 'user-1' } });
        (prisma.user.findUnique as jest.Mock).mockResolvedValue({ creditRoutesOnStrava: true });
        (prisma.account.findFirst as jest.Mock).mockResolvedValue(null);

        const res = await GET() as unknown as { _data: { hasStravaAccount: boolean } };
        expect(res._data.hasStravaAccount).toBe(false);
    });
});

describe('PATCH /api/account', () => {
    const patch = (body: unknown) => PATCH(new Request('http://localhost/api/account', { method: 'PATCH', body: JSON.stringify(body) }));

    it('rejects requests without a session', async () => {
        mockedSession.mockResolvedValue(null);
        const res = await patch({ creditRoutesOnStrava: false }) as unknown as { status: number };
        expect(res.status).toBe(401);
        expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it("updates only the signed-in user's credit setting", async () => {
        mockedSession.mockResolvedValue({ user: { id: 'user-1' } });
        const res = await patch({ creditRoutesOnStrava: false }) as unknown as { _data: unknown };

        expect(prisma.user.update).toHaveBeenCalledWith({ where: { id: 'user-1' }, data: { creditRoutesOnStrava: false } });
        expect(res._data).toEqual({ creditRoutesOnStrava: false });
    });

    it('rejects a non-boolean value', async () => {
        mockedSession.mockResolvedValue({ user: { id: 'user-1' } });
        const res = await patch({ creditRoutesOnStrava: 'no' }) as unknown as { status: number };
        expect(res.status).toBe(400);
        expect(prisma.user.update).not.toHaveBeenCalled();
    });
});
