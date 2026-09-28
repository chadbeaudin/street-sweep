const mockFindUnique = jest.fn();
const mockUpsert = jest.fn();
jest.mock('./prisma', () => ({ prisma: { riddenRoadsJob: { findUnique: (...args: any[]) => mockFindUnique(...args), upsert: (...args: any[]) => mockUpsert(...args) } } }));

const mockEncryptToken = jest.fn();
const mockDecryptToken = jest.fn();
jest.mock('./tokenCrypto', () => ({
    encryptToken: (...args: any[]) => mockEncryptToken(...args),
    decryptToken: (...args: any[]) => mockDecryptToken(...args),
}));

jest.mock('./strava', () => ({ fetchCyclingRiddenRoads: jest.fn() }));

import { refreshRiddenRoadsInBackground, isRiddenRoadsJobActive, decryptJobCreds, riddenRoadsCacheKey } from './riddenRoadsRefresh';

describe('refreshRiddenRoadsInBackground', () => {
    beforeEach(() => mockEncryptToken.mockImplementation((s: string) => `enc:${s}`));

    // This must stay a fast, side-effect-light enqueue -- it's called inline
    // from API route handlers (see app/api/ridden-roads, app/api/strava/activities)
    // and the actual tile-fetch/dedupe work now runs entirely in the separate
    // worker process (worker.ts), never here. See lib/riddenRoadsRefresh.ts's
    // own comment for the prod incident this replaced.
    it('creates a queued job when none exists', async () => {
        mockFindUnique.mockResolvedValue(null);
        await refreshRiddenRoadsInBackground('athlete1', { refreshToken: 'tok' }, 'cycling');
        expect(mockUpsert).toHaveBeenCalledWith(expect.objectContaining({
            where: { key: 'athlete1' },
            create: expect.objectContaining({ key: 'athlete1', athleteId: 'athlete1', mode: 'cycling', status: 'queued' }),
        }));
    });

    it('does not double-enqueue an already-queued job', async () => {
        mockFindUnique.mockResolvedValue({ status: 'queued', updatedAt: new Date() });
        await refreshRiddenRoadsInBackground('athlete1', { refreshToken: 'tok' }, 'cycling');
        expect(mockUpsert).not.toHaveBeenCalled();
    });

    it('does not double-enqueue a job that is actively running', async () => {
        mockFindUnique.mockResolvedValue({ status: 'running', updatedAt: new Date() });
        await refreshRiddenRoadsInBackground('athlete1', { refreshToken: 'tok' }, 'cycling');
        expect(mockUpsert).not.toHaveBeenCalled();
    });

    it('re-enqueues when the existing job is running but stale (worker likely crashed)', async () => {
        mockFindUnique.mockResolvedValue({ status: 'running', updatedAt: new Date(Date.now() - 10 * 60 * 1000) });
        await refreshRiddenRoadsInBackground('athlete1', { refreshToken: 'tok' }, 'cycling');
        expect(mockUpsert).toHaveBeenCalled();
    });

    it('re-enqueues when the existing job previously failed', async () => {
        mockFindUnique.mockResolvedValue({ status: 'failed', updatedAt: new Date() });
        await refreshRiddenRoadsInBackground('athlete1', { refreshToken: 'tok' }, 'cycling');
        expect(mockUpsert).toHaveBeenCalled();
    });

    it('never throws even if the DB call fails, so an unawaited caller is never left with an unhandled rejection', async () => {
        mockFindUnique.mockRejectedValue(new Error('db down'));
        await expect(refreshRiddenRoadsInBackground('athlete1', { refreshToken: 'tok' }, 'cycling')).resolves.toBeUndefined();
    });

    it('encrypts the credentials before storing them, never the raw JSON', async () => {
        mockFindUnique.mockResolvedValue(null);
        const creds = { refreshToken: 'secret-token' };
        await refreshRiddenRoadsInBackground('athlete1', creds, 'cycling');
        expect(mockEncryptToken).toHaveBeenCalledWith(JSON.stringify(creds));
        const call = mockUpsert.mock.calls[0][0];
        expect(call.create.credsEncrypted).toBe(mockEncryptToken.mock.results[0].value);
        expect(call.create.credsEncrypted).not.toBe(JSON.stringify(creds));
    });

    it('uses the mode-suffixed cache key for running so it never mixes with cycling', async () => {
        mockFindUnique.mockResolvedValue(null);
        await refreshRiddenRoadsInBackground('athlete1', { refreshToken: 'tok' }, 'running');
        expect(mockUpsert).toHaveBeenCalledWith(expect.objectContaining({ where: { key: 'athlete1__running' } }));
    });
});

describe('isRiddenRoadsJobActive', () => {
    beforeEach(() => jest.clearAllMocks());

    it('is false when there is no job', async () => {
        mockFindUnique.mockResolvedValue(null);
        expect(await isRiddenRoadsJobActive('athlete1')).toBe(false);
    });

    it('is true for a queued job', async () => {
        mockFindUnique.mockResolvedValue({ status: 'queued', updatedAt: new Date() });
        expect(await isRiddenRoadsJobActive('athlete1')).toBe(true);
    });

    it('is true for a running job with a recent heartbeat', async () => {
        mockFindUnique.mockResolvedValue({ status: 'running', updatedAt: new Date() });
        expect(await isRiddenRoadsJobActive('athlete1')).toBe(true);
    });

    it('is false for a running job whose heartbeat has gone stale (crashed worker)', async () => {
        mockFindUnique.mockResolvedValue({ status: 'running', updatedAt: new Date(Date.now() - 10 * 60 * 1000) });
        expect(await isRiddenRoadsJobActive('athlete1')).toBe(false);
    });

    it('is false for a done/failed job', async () => {
        mockFindUnique.mockResolvedValue({ status: 'failed', updatedAt: new Date() });
        expect(await isRiddenRoadsJobActive('athlete1')).toBe(false);
    });
});

describe('decryptJobCreds', () => {
    it('round-trips through encrypt/decrypt via tokenCrypto', () => {
        mockDecryptToken.mockImplementation((s: string) => s.replace(/^enc:/, ''));
        const creds = { refreshToken: 'abc', clientId: 'x' };
        expect(decryptJobCreds(`enc:${JSON.stringify(creds)}`)).toEqual(creds);
    });
});

describe('riddenRoadsCacheKey', () => {
    it('leaves cycling on the bare athleteId (no migration for existing rows)', () => {
        expect(riddenRoadsCacheKey('42', 'cycling')).toBe('42');
    });
    it('suffixes running so it never collides with cycling', () => {
        expect(riddenRoadsCacheKey('42', 'running')).toBe('42__running');
    });
});
