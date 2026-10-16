const mockJson = jest.fn((data: any, init?: { status?: number }) => ({ status: init?.status ?? 200, _data: data }));
jest.mock('next/server', () => ({ NextResponse: { json: mockJson } }));
jest.mock('@/lib/prisma', () => ({
    prisma: {
        stravaActivityCache: { findUnique: jest.fn() },
        account: { findFirst: jest.fn() },
    },
}));
jest.mock('@/lib/athleteSyncQueue', () => ({ enqueueAthleteSync: jest.fn() }));

import { GET, POST } from './route';
import { prisma } from '@/lib/prisma';
import { enqueueAthleteSync } from '@/lib/athleteSyncQueue';

const ORIGINAL_ENV = process.env;
beforeEach(() => {
    process.env = { ...ORIGINAL_ENV, STRAVA_WEBHOOK_VERIFY_TOKEN: 'verify-me', STRAVA_WEBHOOK_SUBSCRIPTION_ID: '120' };
    (prisma.stravaActivityCache.findUnique as jest.Mock).mockResolvedValue({ athleteId: '42' });
    (prisma.account.findFirst as jest.Mock).mockResolvedValue(null);
});
afterAll(() => { process.env = ORIGINAL_ENV; });

const lastResponse = () => mockJson.mock.calls[mockJson.mock.calls.length - 1];
const post = (body: unknown) => POST(new Request('http://localhost/api/strava/webhook', { method: 'POST', body: JSON.stringify(body) }));
const event = (overrides: Record<string, unknown> = {}) => ({
    object_type: 'activity', object_id: 9001, aspect_type: 'create', owner_id: 42, subscription_id: 120, event_time: 1, updates: {}, ...overrides,
});

describe('GET /api/strava/webhook (subscription handshake)', () => {
    const get = (query: string) => GET(new Request(`http://localhost/api/strava/webhook?${query}`));

    it('echoes the challenge when the verify token matches', async () => {
        await get('hub.mode=subscribe&hub.verify_token=verify-me&hub.challenge=abc123');
        expect(lastResponse()).toEqual([{ 'hub.challenge': 'abc123' }]);
    });

    it('rejects a wrong verify token, and every request when none is configured', async () => {
        await get('hub.mode=subscribe&hub.verify_token=nope&hub.challenge=abc123');
        expect(lastResponse()[1]?.status).toBe(403);
        delete process.env.STRAVA_WEBHOOK_VERIFY_TOKEN;
        await get('hub.mode=subscribe&hub.verify_token=&hub.challenge=abc123');
        expect(lastResponse()[1]?.status).toBe(403);
    });
});

describe('POST /api/strava/webhook', () => {
    it('queues create/update/delete activity events for a known athlete', async () => {
        for (const aspect of ['create', 'update', 'delete']) {
            await post(event({ aspect_type: aspect }));
            expect(enqueueAthleteSync).toHaveBeenLastCalledWith('42', aspect, { activityId: '9001' });
        }
        expect(lastResponse()[1]?.status).toBeUndefined();
    });

    it('queues a purge when the athlete revokes access', async () => {
        await post(event({ object_type: 'athlete', object_id: 42, aspect_type: 'update', updates: { authorized: 'false' } }));
        expect(enqueueAthleteSync).toHaveBeenCalledWith('42', 'deauthorize');
    });

    it('ignores other athlete updates', async () => {
        await post(event({ object_type: 'athlete', object_id: 42, aspect_type: 'update', updates: { name: 'x' } }));
        expect(enqueueAthleteSync).not.toHaveBeenCalled();
    });

    it('accepts a signed-in athlete with no cached activities yet', async () => {
        (prisma.stravaActivityCache.findUnique as jest.Mock).mockResolvedValue(null);
        (prisma.account.findFirst as jest.Mock).mockResolvedValue({ id: 'acct' });
        await post(event());
        expect(enqueueAthleteSync).toHaveBeenCalled();
    });

    it('acknowledges but drops events for athletes this app holds nothing for', async () => {
        (prisma.stravaActivityCache.findUnique as jest.Mock).mockResolvedValue(null);
        await post(event());
        expect(enqueueAthleteSync).not.toHaveBeenCalled();
        expect(lastResponse()[1]?.status).toBeUndefined();
    });

    it('rejects events for a different subscription and malformed bodies', async () => {
        await post(event({ subscription_id: 999 }));
        expect(lastResponse()[1]?.status).toBe(403);
        await post({ hello: 'world' });
        expect(lastResponse()[1]?.status).toBe(400);
        expect(enqueueAthleteSync).not.toHaveBeenCalled();
    });
});
