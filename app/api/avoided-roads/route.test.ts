const mockJson = jest.fn();

jest.mock('next/server', () => ({ NextResponse: { json: mockJson } }));
jest.mock('next-auth', () => ({ getServerSession: jest.fn() }));
jest.mock('@/lib/auth', () => ({ authOptions: {} }));
jest.mock('@/lib/prisma', () => ({
    prisma: { avoidedRoads: { findUnique: jest.fn(), upsert: jest.fn() } },
}));

import { GET, PUT } from './route';
import { prisma } from '@/lib/prisma';
import { getServerSession } from 'next-auth';

const mockedSession = getServerSession as jest.Mock;
type Res = { status: number; _data: unknown };
const road: [number, number][] = [[47.65, -117.42], [47.66, -117.43]];

function putRequest(body: unknown): Request {
    return new Request('http://localhost/api/avoided-roads', { method: 'PUT', body: JSON.stringify(body) });
}

beforeEach(() => {
    jest.clearAllMocks();
    mockJson.mockImplementation((data: unknown, init?: { status?: number }) => ({ status: init?.status ?? 200, _data: data }));
    mockedSession.mockResolvedValue({ user: { id: 'user-1' } });
});

describe('GET /api/avoided-roads', () => {
    it('rejects requests without a session', async () => {
        mockedSession.mockResolvedValue(null);
        const res = await GET() as unknown as Res;
        expect(res.status).toBe(401);
        expect(prisma.avoidedRoads.findUnique).not.toHaveBeenCalled();
    });

    it("returns the signed-in user's saved roads", async () => {
        (prisma.avoidedRoads.findUnique as jest.Mock).mockResolvedValue({ userId: 'user-1', roads: [road] });
        const res = await GET() as unknown as Res;
        expect(prisma.avoidedRoads.findUnique).toHaveBeenCalledWith({ where: { userId: 'user-1' } });
        expect(res._data).toEqual({ roads: [road] });
    });

    it('returns an empty list when nothing is saved yet', async () => {
        (prisma.avoidedRoads.findUnique as jest.Mock).mockResolvedValue(null);
        const res = await GET() as unknown as Res;
        expect(res._data).toEqual({ roads: [] });
    });
});

describe('PUT /api/avoided-roads', () => {
    it('rejects requests without a session', async () => {
        mockedSession.mockResolvedValue(null);
        const res = await PUT(putRequest({ roads: [road] })) as unknown as Res;
        expect(res.status).toBe(401);
        expect(prisma.avoidedRoads.upsert).not.toHaveBeenCalled();
    });

    it("saves the roads on the signed-in user's own row", async () => {
        const res = await PUT(putRequest({ roads: [road] })) as unknown as Res;
        expect(prisma.avoidedRoads.upsert).toHaveBeenCalledWith({
            where: { userId: 'user-1' },
            create: { userId: 'user-1', roads: [road] },
            update: { roads: [road] },
        });
        expect(res.status).toBe(200);
    });

    it('rejects a malformed body', async () => {
        const res = await PUT(putRequest({ roads: 'nope' })) as unknown as Res;
        expect(res.status).toBe(400);
        expect(prisma.avoidedRoads.upsert).not.toHaveBeenCalled();
    });
});
