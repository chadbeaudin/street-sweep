const mockFindUnique = jest.fn();
const mockCreate = jest.fn();
const mockUpdate = jest.fn();
jest.mock('./prisma', () => ({
    prisma: {
        riddenRoadsJob: {
            findUnique: (...args: any[]) => mockFindUnique(...args),
            create: (...args: any[]) => mockCreate(...args),
            update: (...args: any[]) => mockUpdate(...args),
        },
        riddenRoadsTile: {
            findMany: (...args: any[]) => mockFindMany(...args),
        },
    },
}));
const mockFindMany = jest.fn();

const mockEncryptToken = jest.fn();
const mockDecryptToken = jest.fn();
jest.mock('./tokenCrypto', () => ({
    encryptToken: (...args: any[]) => mockEncryptToken(...args),
    decryptToken: (...args: any[]) => mockDecryptToken(...args),
}));

jest.mock('./strava', () => ({ fetchCyclingRiddenRoads: jest.fn() }));

import {
    refreshRiddenRoadsInBackground,
    isRiddenRoadsJobActive,
    getCachedRiddenTiles,
    tilesForBbox,
    decryptJobCreds,
    riddenRoadsCacheKey,
    RIDDEN_VERSION,
} from './riddenRoadsRefresh';

describe('refreshRiddenRoadsInBackground', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockEncryptToken.mockImplementation((s: string) => `enc:${s}`);
    });

    // This must stay a fast, side-effect-light enqueue -- it's called inline
    // from app/api/ridden-roads and the actual tile-fetch/dedupe work now runs
    // entirely in the separate worker process (worker.ts), never here, and
    // only ever over the tiles actually requested (not a rider's whole ride
    // history). See lib/riddenRoadsRefresh.ts's own comment for the prod
    // incident this replaced.
    it('creates a queued job scoped to the requested tiles when none exists', async () => {
        mockFindUnique.mockResolvedValue(null);
        await refreshRiddenRoadsInBackground('athlete1', { refreshToken: 'tok' }, 'cycling', ['1,2', '1,3']);
        expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({ key: 'athlete1', athleteId: 'athlete1', mode: 'cycling', status: 'queued', tiles: ['1,2', '1,3'] }),
        }));
    });

    it('does nothing for an empty tile list', async () => {
        await refreshRiddenRoadsInBackground('athlete1', { refreshToken: 'tok' }, 'cycling', []);
        expect(mockFindUnique).not.toHaveBeenCalled();
    });

    it('extends an already-queued job with new tiles, keeping existing ones', async () => {
        mockFindUnique.mockResolvedValue({ status: 'queued', updatedAt: new Date(), tiles: ['1,2'] });
        await refreshRiddenRoadsInBackground('athlete1', { refreshToken: 'tok' }, 'cycling', ['1,3']);
        expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({
            where: { key: 'athlete1' },
            data: expect.objectContaining({ tiles: expect.arrayContaining(['1,2', '1,3']) }),
        }));
    });

    it('does not touch a running job if every requested tile is already pending', async () => {
        mockFindUnique.mockResolvedValue({ status: 'running', updatedAt: new Date(), tiles: ['1,2', '1,3'] });
        await refreshRiddenRoadsInBackground('athlete1', { refreshToken: 'tok' }, 'cycling', ['1,2']);
        expect(mockUpdate).not.toHaveBeenCalled();
    });

    it('restarts a job that previously failed, scoped to the newly requested tiles', async () => {
        mockFindUnique.mockResolvedValue({ status: 'failed', updatedAt: new Date(), tiles: [] });
        await refreshRiddenRoadsInBackground('athlete1', { refreshToken: 'tok' }, 'cycling', ['1,2']);
        expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({
            where: { key: 'athlete1' },
            data: expect.objectContaining({ status: 'queued', tiles: ['1,2'], error: null }),
        }));
    });

    it('restarts a running-but-stale job (worker likely crashed)', async () => {
        mockFindUnique.mockResolvedValue({ status: 'running', updatedAt: new Date(Date.now() - 10 * 60 * 1000), tiles: ['9,9'] });
        await refreshRiddenRoadsInBackground('athlete1', { refreshToken: 'tok' }, 'cycling', ['1,2']);
        expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({ status: 'queued', tiles: ['1,2'] }),
        }));
    });

    it('never throws even if the DB call fails, so an unawaited caller is never left with an unhandled rejection', async () => {
        mockFindUnique.mockRejectedValue(new Error('db down'));
        await expect(refreshRiddenRoadsInBackground('athlete1', { refreshToken: 'tok' }, 'cycling', ['1,2'])).resolves.toBeUndefined();
    });

    it('encrypts the credentials before storing them, never the raw JSON', async () => {
        mockFindUnique.mockResolvedValue(null);
        const creds = { refreshToken: 'secret-token' };
        await refreshRiddenRoadsInBackground('athlete1', creds, 'cycling', ['1,2']);
        expect(mockEncryptToken).toHaveBeenCalledWith(JSON.stringify(creds));
        const call = mockCreate.mock.calls[0][0];
        expect(call.data.credsEncrypted).toBe(mockEncryptToken.mock.results[0].value);
        expect(call.data.credsEncrypted).not.toBe(JSON.stringify(creds));
    });

    it('uses the mode-suffixed cache key for running so it never mixes with cycling', async () => {
        mockFindUnique.mockResolvedValue(null);
        await refreshRiddenRoadsInBackground('athlete1', { refreshToken: 'tok' }, 'running', ['1,2']);
        expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ key: 'athlete1__running' }) }));
    });
});

describe('isRiddenRoadsJobActive', () => {
    beforeEach(() => jest.clearAllMocks());

    it('is false when there is no job', async () => {
        mockFindUnique.mockResolvedValue(null);
        expect(await isRiddenRoadsJobActive('athlete1', ['1,2'])).toBe(false);
    });

    it('is true for a queued job with an overlapping pending tile', async () => {
        mockFindUnique.mockResolvedValue({ status: 'queued', updatedAt: new Date(), tiles: ['1,2'] });
        expect(await isRiddenRoadsJobActive('athlete1', ['1,2'])).toBe(true);
    });

    it('is false when the job is active but for entirely different tiles', async () => {
        mockFindUnique.mockResolvedValue({ status: 'queued', updatedAt: new Date(), tiles: ['9,9'] });
        expect(await isRiddenRoadsJobActive('athlete1', ['1,2'])).toBe(false);
    });

    it('is true for a running job with a recent heartbeat', async () => {
        mockFindUnique.mockResolvedValue({ status: 'running', updatedAt: new Date(), tiles: ['1,2'] });
        expect(await isRiddenRoadsJobActive('athlete1', ['1,2'])).toBe(true);
    });

    it('is false for a running job whose heartbeat has gone stale (crashed worker)', async () => {
        mockFindUnique.mockResolvedValue({ status: 'running', updatedAt: new Date(Date.now() - 10 * 60 * 1000), tiles: ['1,2'] });
        expect(await isRiddenRoadsJobActive('athlete1', ['1,2'])).toBe(false);
    });

    it('is false for a done/failed job', async () => {
        mockFindUnique.mockResolvedValue({ status: 'failed', updatedAt: new Date(), tiles: ['1,2'] });
        expect(await isRiddenRoadsJobActive('athlete1', ['1,2'])).toBe(false);
    });
});

describe('getCachedRiddenTiles', () => {
    beforeEach(() => jest.clearAllMocks());

    it('returns an empty result for an empty tile list without querying', async () => {
        const result = await getCachedRiddenTiles('athlete1', [], 1000);
        expect(result).toEqual({ roads: [], refreshedAt: null, missing: [] });
        expect(mockFindMany).not.toHaveBeenCalled();
    });

    it('reports tiles with no cache row as missing', async () => {
        mockFindMany.mockResolvedValue([]);
        const result = await getCachedRiddenTiles('athlete1', ['1,2'], 1000);
        expect(result.missing).toEqual(['1,2']);
        expect(result.roads).toEqual([]);
    });

    it('returns roads for fresh, current-version cached tiles and excludes them from missing', async () => {
        mockFindMany.mockResolvedValue([
            { tile: '1,2', roads: [[[1, 2], [3, 4]]], version: RIDDEN_VERSION, refreshedAt: new Date() },
        ]);
        const result = await getCachedRiddenTiles('athlete1', ['1,2'], 1000);
        expect(result.roads).toEqual([[[1, 2], [3, 4]]]);
        expect(result.missing).toEqual([]);
        expect(result.refreshedAt).not.toBeNull();
    });

    it('still returns a stale tile row but also lists it as missing so it gets refreshed', async () => {
        mockFindMany.mockResolvedValue([
            { tile: '1,2', roads: [[[1, 2]]], version: RIDDEN_VERSION, refreshedAt: new Date(Date.now() - 5000) },
        ]);
        const result = await getCachedRiddenTiles('athlete1', ['1,2'], 1000);
        expect(result.roads).toEqual([[[1, 2]]]);
        expect(result.missing).toEqual(['1,2']);
    });

    it('treats an outdated version as missing even though it still returns its roads', async () => {
        mockFindMany.mockResolvedValue([
            { tile: '1,2', roads: [[[1, 2]]], version: RIDDEN_VERSION - 1, refreshedAt: new Date() },
        ]);
        const result = await getCachedRiddenTiles('athlete1', ['1,2'], 1000);
        expect(result.missing).toEqual(['1,2']);
    });
});

describe('tilesForBbox', () => {
    it('covers a small bbox with at least one tile', () => {
        const tiles = tilesForBbox({ south: 39.0, north: 39.01, west: -105.0, east: -104.99 });
        expect(tiles.length).toBeGreaterThan(0);
    });

    it('is deterministic for the same bbox', () => {
        const bbox = { south: 39.0, north: 39.05, west: -105.0, east: -104.9 };
        expect(tilesForBbox(bbox)).toEqual(tilesForBbox(bbox));
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
