const mockFindFirst = jest.fn();
const mockUpdateMany = jest.fn();
const mockFindUnique = jest.fn();
const mockUpdate = jest.fn();
const mockDelete = jest.fn();
const mockCacheUpsert = jest.fn();
jest.mock('./prisma', () => ({
    prisma: {
        riddenRoadsJob: {
            findFirst: (...args: any[]) => mockFindFirst(...args),
            updateMany: (...args: any[]) => mockUpdateMany(...args),
            findUnique: (...args: any[]) => mockFindUnique(...args),
            update: (...args: any[]) => mockUpdate(...args),
            delete: (...args: any[]) => mockDelete(...args),
        },
        riddenRoadsCache: { upsert: (...args: any[]) => mockCacheUpsert(...args) },
    },
}));

const mockFetchOSMData = jest.fn();
jest.mock('./overpass', () => ({ fetchOSMData: (...args: any[]) => mockFetchOSMData(...args) }));

const mockRoadsFromOSM = jest.fn();
jest.mock('./roadsFromOSM', () => ({ roadsFromOSM: (...args: any[]) => mockRoadsFromOSM(...args) }));

const mockDedupe = jest.fn();
jest.mock('./riddenRoads', () => ({ dedupeRiddenRoads: (...args: any[]) => mockDedupe(...args) }));

const mockFetchCyclingRiddenRoads = jest.fn();
jest.mock('./strava', () => ({ fetchCyclingRiddenRoads: (...args: any[]) => mockFetchCyclingRiddenRoads(...args) }));

const mockDecryptJobCreds = jest.fn();
jest.mock('./riddenRoadsRefresh', () => ({
    RIDDEN_VERSION: 12,
    TILE: 0.02,
    MAX_TILES: 5000,
    decryptJobCreds: (...args: any[]) => mockDecryptJobCreds(...args),
}));

import { claimNextJob, tickRiddenRoadsWorker } from './riddenRoadsWorkerJob';

const baseJob = {
    key: 'athlete1', athleteId: 'athlete1', mode: 'cycling', status: 'queued',
    tilesDone: 0, tilesTotal: 0, partialRoads: null, credsEncrypted: 'enc', error: null,
    updatedAt: new Date(),
};

beforeEach(() => {
    jest.clearAllMocks();
    mockDecryptJobCreds.mockReturnValue({ refreshToken: 'tok' });
    mockFetchCyclingRiddenRoads.mockResolvedValue({ riddenRoads: [[[0, 0], [0.01, 0.01]]] });
    mockFetchOSMData.mockResolvedValue({ elements: [] });
    mockRoadsFromOSM.mockReturnValue([]);
    mockDedupe.mockReturnValue([[[0, 0], [0.01, 0.01]]]);
    mockUpdateMany.mockResolvedValue({ count: 1 });
    mockUpdate.mockResolvedValue({});
});

describe('claimNextJob', () => {
    it('returns null when there is nothing to claim', async () => {
        mockFindFirst.mockResolvedValue(null);
        expect(await claimNextJob()).toBeNull();
        expect(mockUpdateMany).not.toHaveBeenCalled();
    });

    it('does not treat a job as claimed if another tick already grabbed it (race)', async () => {
        mockFindFirst.mockResolvedValue(baseJob);
        mockUpdateMany.mockResolvedValue({ count: 0 });
        expect(await claimNextJob()).toBeNull();
    });

    it('claims a queued job by transitioning it to running', async () => {
        mockFindFirst.mockResolvedValue(baseJob);
        mockFindUnique.mockResolvedValue({ ...baseJob, status: 'running' });
        const claimed = await claimNextJob();
        expect(mockUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
            where: { key: 'athlete1', status: 'queued' },
            data: { status: 'running' },
        }));
        expect(claimed?.status).toBe('running');
    });
});

describe('tickRiddenRoadsWorker', () => {
    it('does nothing when there is no job to claim', async () => {
        mockFindFirst.mockResolvedValue(null);
        expect(await tickRiddenRoadsWorker()).toEqual({ processed: false });
        expect(mockFetchCyclingRiddenRoads).not.toHaveBeenCalled();
    });

    it('processes a job end to end and deletes it on success', async () => {
        mockFindFirst.mockResolvedValue(baseJob);
        mockFindUnique.mockResolvedValue({ ...baseJob, status: 'running' });
        const result = await tickRiddenRoadsWorker();
        expect(result).toEqual({ processed: true, key: 'athlete1' });
        expect(mockCacheUpsert).toHaveBeenCalledWith(expect.objectContaining({ where: { athleteId: 'athlete1' } }));
        expect(mockDelete).toHaveBeenCalledWith({ where: { key: 'athlete1' } });
    });

    it('resumes from the last checkpoint instead of re-fetching already-done tiles', async () => {
        const resumedJob = { ...baseJob, tilesDone: 1, partialRoads: [[[9, 9], [9.1, 9.1]]] };
        mockFindFirst.mockResolvedValue(resumedJob);
        mockFindUnique.mockResolvedValue({ ...resumedJob, status: 'running' });
        // Two tiles total from the ride's bbox; tilesDone=1 means only the second should be fetched.
        mockFetchCyclingRiddenRoads.mockResolvedValue({ riddenRoads: [[[0, 0], [0.03, 0.03]]] });
        await tickRiddenRoadsWorker();
        // dedupeRiddenRoads should see the previously-checkpointed road plus whatever this run fetched.
        const dedupeArgs = mockDedupe.mock.calls[0];
        expect(dedupeArgs[1]).toEqual(expect.arrayContaining([[[9, 9], [9.1, 9.1]]]));
    });

    it('marks the job failed (not deleted) when too many tile fetches fail, and does not touch the cache', async () => {
        mockFindFirst.mockResolvedValue(baseJob);
        mockFindUnique.mockResolvedValue({ ...baseJob, status: 'running' });
        mockFetchOSMData.mockRejectedValue(new Error('overpass down'));
        await tickRiddenRoadsWorker();
        expect(mockCacheUpsert).not.toHaveBeenCalled();
        expect(mockDelete).not.toHaveBeenCalled();
        expect(mockUpdate).toHaveBeenCalledWith(expect.objectContaining({
            where: { key: 'athlete1' },
            data: expect.objectContaining({ status: 'failed' }),
        }));
    });

    it('never throws out of tickRiddenRoadsWorker even when marking the job failed itself errors', async () => {
        mockFindFirst.mockResolvedValue(baseJob);
        mockFindUnique.mockResolvedValue({ ...baseJob, status: 'running' });
        mockFetchCyclingRiddenRoads.mockRejectedValue(new Error('strava down'));
        mockUpdate.mockRejectedValue(new Error('db also down'));
        await expect(tickRiddenRoadsWorker()).resolves.toEqual({ processed: true, key: 'athlete1' });
    });
});
