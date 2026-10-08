const mockFindFirst = jest.fn();
const mockUpdateMany = jest.fn();
const mockFindUnique = jest.fn();
const mockUpdate = jest.fn();
const mockDelete = jest.fn();
const mockTileUpsert = jest.fn();
const mockTileDeleteMany = jest.fn();
const mockTileCreateMany = jest.fn();
const mockTransaction = jest.fn();
const mockExecuteRaw = jest.fn();
jest.mock('./prisma', () => ({
    prisma: {
        $transaction: (...args: any[]) => mockTransaction(...args),
        $executeRaw: (strings: TemplateStringsArray, ...values: any[]) => mockExecuteRaw(strings.join('?'), ...values),
        riddenRoadsJob: {
            findFirst: (...args: any[]) => mockFindFirst(...args),
            updateMany: (...args: any[]) => mockUpdateMany(...args),
            findUnique: (...args: any[]) => mockFindUnique(...args),
            update: (...args: any[]) => mockUpdate(...args),
            delete: (...args: any[]) => mockDelete(...args),
        },
        riddenRoadsTile: {
            upsert: (...args: any[]) => mockTileUpsert(...args),
            deleteMany: (...args: any[]) => mockTileDeleteMany(...args),
            createMany: (...args: any[]) => mockTileCreateMany(...args),
        },
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
    mockTransaction.mockResolvedValue([]);
    mockExecuteRaw.mockResolvedValue(1);
});

const sqlCalls = (pattern: RegExp) => mockExecuteRaw.mock.calls.filter(([sql]) => pattern.test(sql));

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
        expect(sqlCalls(/UPDATE ridden_roads_jobs\s+SET tiles/)).toEqual([[expect.any(String), ['1,2'], 'athlete1']]);
        expect(sqlCalls(/DELETE FROM ridden_roads_jobs .* jsonb_array_length\(tiles\) = 0/)).toHaveLength(1);
    });

    it('passes the tile bounds to matching so gap filling only trusts junctions inside the fetched area', async () => {
        mockFindFirst.mockResolvedValue(baseJob);
        mockFindUnique.mockResolvedValue({ ...baseJob, status: 'running' });
        await tickRiddenRoadsWorker();
        expect(mockDedupe).toHaveBeenCalledWith(expect.anything(), expect.anything(), { south: 0.02, north: 0.04, west: 0.04, east: 0.06 });
    });

    it('writes all empty tiles in one batch without fetching OSM data for them', async () => {
        mockFindFirst.mockResolvedValue({ ...baseJob, tiles: ['1,2', '1,3', '1,4'] });
        mockFindUnique.mockResolvedValue({ ...baseJob, tiles: ['1,2', '1,3', '1,4'], status: 'running' });
        mockFilterToBbox.mockReturnValue([]); // no ride passes through these tiles
        await tickRiddenRoadsWorker();
        expect(mockFetchOSMData).not.toHaveBeenCalled();
        expect(mockTileUpsert).not.toHaveBeenCalled();
        expect(mockTileCreateMany).toHaveBeenCalledTimes(1);
        expect(mockTileCreateMany.mock.calls[0][0].data.map((d: any) => [d.tile, d.roads])).toEqual([['1,2', []], ['1,3', []], ['1,4', []]]);
        expect(mockTransaction).toHaveBeenCalledTimes(1);
        expect(sqlCalls(/SET tiles/)).toEqual([[expect.any(String), ['1,2', '1,3', '1,4'], 'athlete1']]);
    });

    it('fetches tiles with rides concurrently, capped at the configured limit', async () => {
        const tiles = ['1,1', '1,2', '1,3', '1,4', '1,5', '1,6'];
        mockFindFirst.mockResolvedValue({ ...baseJob, tiles });
        mockFindUnique.mockResolvedValue({ ...baseJob, tiles, status: 'running' });
        let inFlight = 0, maxInFlight = 0;
        mockFetchOSMData.mockImplementation(async () => {
            maxInFlight = Math.max(maxInFlight, ++inFlight);
            await new Promise(r => setTimeout(r, 5));
            inFlight--;
            return { elements: [] };
        });
        await tickRiddenRoadsWorker();
        expect(mockFetchOSMData).toHaveBeenCalledTimes(6);
        expect(maxInFlight).toBe(4);
        expect(mockTileUpsert).toHaveBeenCalledTimes(6);
    });

    it('does not fetch OSM data or the rider history at all once every tile is already done', async () => {
        mockFindFirst.mockResolvedValue({ ...baseJob, tiles: [] });
        mockFindUnique.mockResolvedValue({ ...baseJob, tiles: [], status: 'running' });
        const result = await tickRiddenRoadsWorker();
        expect(result).toEqual({ processed: true, key: 'athlete1' });
        expect(mockFetchCyclingRiddenRoads).not.toHaveBeenCalled();
        expect(sqlCalls(/DELETE FROM ridden_roads_jobs/)).toHaveLength(1);
    });

    it('leaves a failed tile pending and requeues the job for the next tick instead of failing it', async () => {
        mockFindFirst.mockResolvedValue(baseJob);
        mockFindUnique.mockResolvedValue({ ...baseJob, status: 'running' });
        mockFetchOSMData.mockRejectedValue(new Error('overpass down'));
        const result = await tickRiddenRoadsWorker();
        expect(result).toEqual({ processed: true, key: 'athlete1' });
        expect(mockTileUpsert).not.toHaveBeenCalled();
        expect(sqlCalls(/SET tiles/)).toHaveLength(0);
        expect(sqlCalls(/SET status = 'queued'/)).toHaveLength(1);
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
