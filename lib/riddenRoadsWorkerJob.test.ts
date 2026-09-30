const mockFindFirst = jest.fn();
const mockUpdateMany = jest.fn();
const mockFindUnique = jest.fn();
const mockUpdate = jest.fn();
const mockDelete = jest.fn();
const mockTileUpsert = jest.fn();
jest.mock('./prisma', () => ({
    prisma: {
        riddenRoadsJob: {
            findFirst: (...args: any[]) => mockFindFirst(...args),
            updateMany: (...args: any[]) => mockUpdateMany(...args),
            findUnique: (...args: any[]) => mockFindUnique(...args),
            update: (...args: any[]) => mockUpdate(...args),
            delete: (...args: any[]) => mockDelete(...args),
        },
        riddenRoadsTile: { upsert: (...args: any[]) => mockTileUpsert(...args) },
    },
}));

const mockFetchOSMData = jest.fn();
jest.mock('./overpass', () => ({ fetchOSMData: (...args: any[]) => mockFetchOSMData(...args) }));

const mockRoadsFromOSM = jest.fn();
jest.mock('./roadsFromOSM', () => ({ roadsFromOSM: (...args: any[]) => mockRoadsFromOSM(...args) }));

const mockDedupe = jest.fn();
const mockFilterToBbox = jest.fn();
jest.mock('./riddenRoads', () => ({
    dedupeRiddenRoads: (...args: any[]) => mockDedupe(...args),
    filterRiddenRoadsToBbox: (...args: any[]) => mockFilterToBbox(...args),
}));

const mockFetchCyclingRiddenRoads = jest.fn();
jest.mock('./strava', () => ({ fetchCyclingRiddenRoads: (...args: any[]) => mockFetchCyclingRiddenRoads(...args) }));

const mockDecryptJobCreds = jest.fn();
jest.mock('./riddenRoadsRefresh', () => ({
    RIDDEN_VERSION: 12,
    tileBbox: (tile: string) => {
        const [ty, tx] = tile.split(',').map(Number);
        return { south: ty * 0.02, north: (ty + 1) * 0.02, west: tx * 0.02, east: (tx + 1) * 0.02 };
    },
    decryptJobCreds: (...args: any[]) => mockDecryptJobCreds(...args),
}));

import { claimNextJob, tickRiddenRoadsWorker } from './riddenRoadsWorkerJob';

const baseJob = {
    key: 'athlete1', athleteId: 'athlete1', mode: 'cycling', status: 'queued',
    tiles: ['1,2'], credsEncrypted: 'enc', error: null,
    updatedAt: new Date(),
};

beforeEach(() => {
    jest.clearAllMocks();
    mockDecryptJobCreds.mockReturnValue({ refreshToken: 'tok' });
    mockFetchCyclingRiddenRoads.mockResolvedValue({ riddenRoads: [[[0, 0], [0.01, 0.01]]] });
    mockFilterToBbox.mockReturnValue([[[0, 0], [0.01, 0.01]]]);
    mockFetchOSMData.mockResolvedValue({ elements: [] });
    mockRoadsFromOSM.mockReturnValue([]);
    mockDedupe.mockReturnValue([[[0, 0], [0.01, 0.01]]]);
    mockUpdateMany.mockResolvedValue({ count: 1 });
    mockUpdate.mockResolvedValue({});
    mockTileUpsert.mockResolvedValue({});
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

    it('processes every pending tile and deletes the job once none remain', async () => {
        mockFindFirst.mockResolvedValue(baseJob);
        mockFindUnique.mockResolvedValue({ ...baseJob, status: 'running' });
        const result = await tickRiddenRoadsWorker();
        expect(result).toEqual({ processed: true, key: 'athlete1' });
        expect(mockTileUpsert).toHaveBeenCalledWith(expect.objectContaining({
            where: { athleteKey_tile: { athleteKey: 'athlete1', tile: '1,2' } },
        }));
        expect(mockDelete).toHaveBeenCalledWith({ where: { key: 'athlete1' } });
    });

    it('only fetches OSM data for tiles a rider actually has GPS data in, not empty ones', async () => {
        mockFindFirst.mockResolvedValue(baseJob);
        mockFindUnique.mockResolvedValue({ ...baseJob, status: 'running' });
        mockFilterToBbox.mockReturnValue([]); // no ride passes through this tile
        await tickRiddenRoadsWorker();
        expect(mockFetchOSMData).not.toHaveBeenCalled();
        expect(mockTileUpsert).toHaveBeenCalledWith(expect.objectContaining({
            create: expect.objectContaining({ roads: [] }),
        }));
    });

    it('does not fetch OSM data or the rider history at all once every tile is already done', async () => {
        mockFindFirst.mockResolvedValue({ ...baseJob, tiles: [] });
        mockFindUnique.mockResolvedValue({ ...baseJob, tiles: [], status: 'running' });
        const result = await tickRiddenRoadsWorker();
        expect(result).toEqual({ processed: true, key: 'athlete1' });
        expect(mockFetchCyclingRiddenRoads).not.toHaveBeenCalled();
        expect(mockDelete).toHaveBeenCalledWith({ where: { key: 'athlete1' } });
    });

    it('leaves a failed tile pending for the next tick instead of failing the whole job', async () => {
        mockFindFirst.mockResolvedValue(baseJob);
        mockFindUnique.mockResolvedValue({ ...baseJob, status: 'running' });
        mockFetchOSMData.mockRejectedValue(new Error('overpass down'));
        const result = await tickRiddenRoadsWorker();
        expect(result).toEqual({ processed: true, key: 'athlete1' });
        expect(mockTileUpsert).not.toHaveBeenCalled();
        expect(mockDelete).not.toHaveBeenCalled();
        // The job's tile list is untouched -- next tick will retry the same tile.
        expect(mockUpdate).not.toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'failed' }) }));
    });

    it('never throws out of tickRiddenRoadsWorker even when marking the job failed itself errors', async () => {
        mockFindFirst.mockResolvedValue(baseJob);
        mockFindUnique.mockResolvedValue({ ...baseJob, status: 'running' });
        mockFetchCyclingRiddenRoads.mockRejectedValue(new Error('strava down'));
        mockUpdate.mockRejectedValue(new Error('db also down'));
        await expect(tickRiddenRoadsWorker()).resolves.toEqual({ processed: true, key: 'athlete1' });
    });
});
