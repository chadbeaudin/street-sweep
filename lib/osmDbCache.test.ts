import { prisma } from './prisma';

// Mock prisma before importing overpass so the module picks up the mock
jest.mock('./prisma', () => ({
    prisma: {
        osmCache: {
            findUnique: jest.fn(),
            upsert: jest.fn().mockResolvedValue({}),
            delete: jest.fn().mockResolvedValue({}),
        }
    }
}));

// Disk cache layer must also be mocked — without it, dev/test runs may hit
// real cached tiles on the filesystem and the network-fetch path never executes.
jest.mock('./osmDiskCache', () => ({
    readDiskCache: jest.fn().mockResolvedValue(null),
    writeDiskCache: jest.fn().mockResolvedValue(undefined),
}));

import { fetchOSMData, resetCircuitBreakers, clearOSMCache } from './overpass';
import { readDiskCache, writeDiskCache } from './osmDiskCache';

const mockFindUnique = prisma.osmCache.findUnique as jest.Mock;
const mockUpsert = prisma.osmCache.upsert as jest.Mock;
const mockReadDisk = readDiskCache as jest.Mock;
const mockWriteDisk = writeDiskCache as jest.Mock;

// Small bbox that snaps to a single 0.05×0.05 tile (0.0025 sq deg) — below the
// sparse-check threshold so 2-element mock data isn't rejected as incomplete.
const mockBBox = { south: 47.61, west: -117.49, north: 47.64, east: -117.46 };

const mockOsmData = {
    version: 0.6,
    generator: 'Overpass API',
    osm3s: { timestamp_osm_base: '2026-01-01T00:00:00Z', copyright: 'ODbL' },
    elements: [
        // Node at SW corner of mockBBox
        { type: 'node' as const, id: 1, lat: 47.610, lon: -117.490 },
        // Node at NE corner of mockBBox (so data bounds cover the request)
        { type: 'node' as const, id: 2, lat: 47.640, lon: -117.460 },
        { type: 'way' as const, id: 3, nodes: [1, 2], tags: { highway: 'residential' } }
    ]
};

describe('OSM DB cache', () => {
    beforeEach(() => {
        global.fetch = jest.fn();
        resetCircuitBreakers();
        clearOSMCache();
        jest.clearAllMocks();
        mockUpsert.mockResolvedValue({});
        mockReadDisk.mockResolvedValue(null);
        mockWriteDisk.mockResolvedValue(undefined);
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    it('returns DB-cached data without hitting the network', async () => {
        mockFindUnique.mockResolvedValue({
            key: 'v7_47.6000,-117.5000,47.7000,-117.3000',
            data: mockOsmData,
            fetchedAt: new Date()
        });

        const result = await fetchOSMData(mockBBox);

        expect(result.elements).toHaveLength(3);
        expect(global.fetch).not.toHaveBeenCalled();
    });

    it('falls through to network when DB cache is empty', async () => {
        mockFindUnique.mockResolvedValue(null);
        (global.fetch as jest.Mock).mockResolvedValueOnce({
            ok: true,
            json: async () => mockOsmData
        });

        const result = await fetchOSMData(mockBBox);

        expect(result.elements).toHaveLength(3);
        expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    it('falls through to network when DB cache is expired', async () => {
        const thirtyOneDaysAgo = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000);
        mockFindUnique.mockResolvedValue({
            key: 'v7_47.6000,-117.5000,47.7000,-117.3000',
            data: mockOsmData,
            fetchedAt: thirtyOneDaysAgo
        });
        (global.fetch as jest.Mock).mockResolvedValueOnce({
            ok: true,
            json: async () => mockOsmData
        });

        const result = await fetchOSMData(mockBBox);

        expect(global.fetch).toHaveBeenCalled();
        expect(result.elements).toHaveLength(3);
    });

    it('writes to DB cache after a successful network fetch', async () => {
        mockFindUnique.mockResolvedValue(null);
        (global.fetch as jest.Mock).mockResolvedValueOnce({
            ok: true,
            json: async () => mockOsmData
        });

        await fetchOSMData(mockBBox);

        // Allow fire-and-forget upsert to resolve
        await new Promise(resolve => setTimeout(resolve, 10));
        expect(mockUpsert).toHaveBeenCalledWith(expect.objectContaining({
            where: { key: expect.stringContaining('v7_') },
            create: expect.objectContaining({ data: mockOsmData })
        }));
    });

    it('warms memory cache from DB so second call skips both DB and network', async () => {
        mockFindUnique.mockResolvedValueOnce({
            key: 'v7_47.6000,-117.5000,47.7000,-117.3000',
            data: mockOsmData,
            fetchedAt: new Date()
        });

        await fetchOSMData(mockBBox); // warms memory cache from DB
        jest.clearAllMocks();
        mockFindUnique.mockResolvedValue(null); // DB would return null on next call

        const result = await fetchOSMData(mockBBox); // should hit memory cache

        expect(result.elements).toHaveLength(3);
        expect(mockFindUnique).not.toHaveBeenCalled();
        expect(global.fetch).not.toHaveBeenCalled();
    });

    it('handles DB errors gracefully and falls through to network', async () => {
        mockFindUnique.mockRejectedValue(new Error('DB connection failed'));
        (global.fetch as jest.Mock).mockResolvedValueOnce({
            ok: true,
            json: async () => mockOsmData
        });

        const result = await fetchOSMData(mockBBox);

        expect(result.elements).toHaveLength(3);
    });

    it('returns empty fallback when DB is down and all mirrors fail', async () => {
        mockFindUnique.mockRejectedValue(new Error('DB connection failed'));
        (global.fetch as jest.Mock).mockResolvedValue({
            ok: false,
            status: 504,
            statusText: 'Gateway Timeout',
            text: async () => 'Gateway Timeout'
        });

        const result = await fetchOSMData(mockBBox);

        expect(result.elements).toEqual([]);
        expect(result.generator).toBe('StreetSweep fallback');
    });
});
