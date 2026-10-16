const mockJson = jest.fn();

jest.mock('next/server', () => ({ NextResponse: { json: mockJson } }));
jest.mock('next-auth', () => ({ getServerSession: jest.fn() }));
jest.mock('@/lib/auth', () => ({ authOptions: {} }));
jest.mock('@/lib/accountDeletion', () => ({ deleteAccount: jest.fn() }));

import { DELETE } from './route';
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
