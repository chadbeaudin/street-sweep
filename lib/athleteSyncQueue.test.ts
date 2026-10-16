jest.mock('./prisma', () => ({ prisma: { stravaSyncEvent: { create: jest.fn(), count: jest.fn() } } }));
jest.mock('./tokenCrypto', () => ({ encryptToken: (v: string) => `enc(${v})` }));

import { enqueueAthleteSync, hasPendingSync } from './athleteSyncQueue';
import { prisma } from './prisma';

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
