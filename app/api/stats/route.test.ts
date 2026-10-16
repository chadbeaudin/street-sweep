const mockJson = jest.fn((data: any, init?: { status?: number }) => ({ status: init?.status ?? 200, _data: data }));
jest.mock('next/server', () => ({ NextResponse: { json: mockJson } }));
jest.mock('@/lib/strava', () => ({ resolveAthleteId: jest.fn() }));
jest.mock('@/lib/prisma', () => ({ prisma: { statsCache: { findUnique: jest.fn() } } }));
jest.mock('@/lib/serverStravaCredentials', () => ({ getSessionStravaCredentials: jest.fn() }));
jest.mock('@/lib/athleteSyncQueue', () => ({ enqueueAthleteSync: jest.fn(), hasPendingSync: jest.fn() }));
jest.mock('@/lib/statsCompute', () => ({
    STATS_VERSION: 8,
    statsCacheKey: (id: string, mode: string) => mode === 'running' ? `${id}__running` : id,
    withDbRetry: (op: () => Promise<unknown>) => op(),
}));

import { POST } from './route';
import { resolveAthleteId } from '@/lib/strava';
import { prisma } from '@/lib/prisma';
import { getSessionStravaCredentials } from '@/lib/serverStravaCredentials';
import { enqueueAthleteSync, hasPendingSync } from '@/lib/athleteSyncQueue';

const creds = { refreshToken: 'r' };
const post = (body: unknown) => POST(new Request('http://localhost/api/stats', { method: 'POST', body: JSON.stringify(body) }));
const lastResponse = () => mockJson.mock.calls[mockJson.mock.calls.length - 1];
const row = (overrides: Record<string, unknown> = {}, refreshedAt = new Date()) => ({ athleteId: '42', stats: { version: 8, totalActivities: 3, ...overrides }, refreshedAt });

beforeEach(() => {
    (resolveAthleteId as jest.Mock).mockResolvedValue('42');
    (getSessionStravaCredentials as jest.Mock).mockResolvedValue(null);
    (hasPendingSync as jest.Mock).mockResolvedValue(false);
});

describe('POST /api/stats (#118)', () => {
    it('serves a current worker-computed row without queuing anything', async () => {
        (prisma.statsCache.findUnique as jest.Mock).mockResolvedValue(row());
        await post({ stravaCredentials: creds });
        expect(enqueueAthleteSync).not.toHaveBeenCalled();
        expect(lastResponse()[0]).toMatchObject({ totalActivities: 3, stale: false, refreshing: false, computing: false });
    });

    it('queues a recompute for a first-time athlete instead of computing inline', async () => {
        (prisma.statsCache.findUnique as jest.Mock).mockResolvedValue(null);
        await post({ stravaCredentials: creds, activityMode: 'running' });
        expect(prisma.statsCache.findUnique).toHaveBeenCalledWith({ where: { athleteId: '42__running' } });
        expect(enqueueAthleteSync).toHaveBeenCalledWith('42', 'recompute', { mode: 'running', creds });
        expect(lastResponse()[0]).toEqual({ refreshedAt: null, stale: false, refreshing: true, computing: true });
    });

    it('queues a recompute for an outdated schema or a row past the safety TTL', async () => {
        (prisma.statsCache.findUnique as jest.Mock).mockResolvedValue(row({ version: 7 }));
        await post({ stravaCredentials: creds });
        expect(enqueueAthleteSync).toHaveBeenCalledTimes(1);
        (prisma.statsCache.findUnique as jest.Mock).mockResolvedValue(row({}, new Date(Date.now() - 8 * 24 * 60 * 60 * 1000)));
        await post({ stravaCredentials: creds });
        expect(enqueueAthleteSync).toHaveBeenCalledTimes(2);
        expect(lastResponse()[0]).toMatchObject({ stale: true, refreshing: true });
    });

    it('reports refreshing without queuing a duplicate while work is already pending', async () => {
        (prisma.statsCache.findUnique as jest.Mock).mockResolvedValue(null);
        (hasPendingSync as jest.Mock).mockResolvedValue(true);
        await post({ stravaCredentials: creds });
        expect(enqueueAthleteSync).not.toHaveBeenCalled();
        expect(lastResponse()[0]).toMatchObject({ refreshing: true, computing: true });
    });

    it('uses the signed-in session credentials when the client has none', async () => {
        (getSessionStravaCredentials as jest.Mock).mockResolvedValue({ refreshToken: 'session' });
        (prisma.statsCache.findUnique as jest.Mock).mockResolvedValue(row());
        await post({ stravaCredentials: { sessionLinked: true } });
        expect(resolveAthleteId).toHaveBeenCalledWith({ sessionLinked: true, refreshToken: 'session' });
    });

    it('rejects a request with no way to identify the athlete', async () => {
        await post({});
        expect(lastResponse()[1]?.status).toBe(400);
    });
});
