jest.mock('./prisma', () => ({ prisma: { stravaSyncEvent: { create: jest.fn(), count: jest.fn(), findFirst: jest.fn() } } }));
jest.mock('./tokenCrypto', () => ({ encryptToken: (v: string) => `enc(${v})` }));

import { enqueueAthleteSync, hasPendingSync, MAX_PENDING_PER_ATHLETE } from './athleteSyncQueue';
import { prisma } from './prisma';
import * as metrics from './metrics';

const create = prisma.stravaSyncEvent.create as jest.Mock;

describe('athleteSyncQueue (#118)', () => {
    it('stores a webhook event with no credentials attached', async () => {
        await enqueueAthleteSync('42', 'create', { activityId: '9' });
        expect(create).toHaveBeenCalledWith({ data: { athleteId: '42', aspect: 'create', activityId: '9', mode: null, credsEncrypted: null } });
    });

    it('encrypts the caller credentials for a recompute', async () => {
        await enqueueAthleteSync('42', 'recompute', { mode: 'running', creds: { refreshToken: 'r' } });
        expect(create.mock.calls[0][0].data).toMatchObject({ mode: 'running', credsEncrypted: 'enc({"refreshToken":"r"})' });
    });

    it('never throws into the calling request', async () => {
        create.mockRejectedValue(new Error('db down'));
        await expect(enqueueAthleteSync('42', 'resync')).resolves.toBeUndefined();
    });

    it('reports whether any work is queued for the athlete', async () => {
        (prisma.stravaSyncEvent.count as jest.Mock).mockResolvedValue(2);
        expect(await hasPendingSync('42')).toBe(true);
        (prisma.stravaSyncEvent.count as jest.Mock).mockResolvedValue(0);
        expect(await hasPendingSync('42')).toBe(false);
    });
});

describe('athleteSyncQueue metrics (#117)', () => {
    it('counts a queue write that failed, since that work is lost', async () => {
        const counted = jest.spyOn(metrics, 'incrementMetric');
        create.mockRejectedValue(new Error('db down'));
        await enqueueAthleteSync('42', 'create', { activityId: '1' });
        expect(counted).toHaveBeenCalledWith('worker.enqueue_failed');
    });
});

describe('athleteSyncQueue bounds (#199)', () => {
    const findFirst = prisma.stravaSyncEvent.findFirst as jest.Mock;
    const count = prisma.stravaSyncEvent.count as jest.Mock;

    it('skips an event identical to one still pending', async () => {
        findFirst.mockResolvedValue({ id: 1 });
        await enqueueAthleteSync('42', 'update', { activityId: '9' });
        expect(findFirst).toHaveBeenCalledWith({ where: { athleteId: '42', claimedAt: null, aspect: 'update', activityId: '9', mode: null }, select: { id: true } });
        expect(create).not.toHaveBeenCalled();
    });

    it('drops new events once the athlete has too many pending', async () => {
        findFirst.mockResolvedValue(null);
        count.mockResolvedValue(MAX_PENDING_PER_ATHLETE);
        await enqueueAthleteSync('42', 'create', { activityId: '10' });
        expect(count).toHaveBeenCalledWith({ where: { athleteId: '42', claimedAt: null } });
        expect(create).not.toHaveBeenCalled();
    });

    it('still queues a deauthorize when the queue is full', async () => {
        findFirst.mockResolvedValue(null);
        count.mockResolvedValue(MAX_PENDING_PER_ATHLETE);
        await enqueueAthleteSync('42', 'deauthorize');
        expect(create).toHaveBeenCalled();
    });
});
