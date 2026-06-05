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

import { fetchOSMData, resetCircuitBreakers, clearOSMCache } from './overpass';

const mockFindUnique = prisma.osmCache.findUnique as jest.Mock;
const mockUpsert = prisma.osmCache.upsert as jest.Mock;

// Small bbox that snaps to a single 0.05×0.05 tile (0.0025 sq deg) — below the
// sparse-check threshold so 2-element mock data isn't rejected as incomplete.
const mockBBox = { south: 47.61, west: -117.49, north: 47.64, east: -117.46 };

const mockOsmData = {
    version: 0.6,
    generator: 'Overpass API',
    osm3s: { timestamp_osm_base: '2026-01-01T00:00:00Z', copyright: 'ODbL' },
    elements: [
        { type: 'node' as const, id: 1, lat: 47.65, lon: -117.4 },
        { type: 'way' as const, id: 2, nodes: [1], tags: { highway: 'residential' } }
    ]
};

describe('OSM DB cache', () => {
    beforeEach(() => {
        global.fetch = jest.fn();
        resetCircuitBreakers();
        clearOSMCache();
        jest.clearAllMocks();
        mockUpsert.mockResolvedValue({});
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    it('returns DB-cached data without hitting the network', async () => {
        mockFindUnique.mockResolvedValue({
            key: 'v3_47.600,-117.500,47.700,-117.300',
            data: mockOsmData,
            fetchedAt: new Date()
        });

        const result = await fetchOSMData(mockBBox);

        expect(result.elements).toHaveLength(2);
        expect(global.fetch).not.toHaveBeenCalled();
    });

    it('falls through to network when DB cache is empty', async () => {
        mockFindUnique.mockResolvedValue(null);
        (global.fetch as jest.Mock).mockResolvedValueOnce({
            ok: true,
            json: async () => mockOsmData
        });

        const result = await fetchOSMData(mockBBox);

        expect(result.elements).toHaveLength(2);
        expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    it('falls through to network when DB cache is expired', async () => {
        const thirtyOneDaysAgo = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000);
        mockFindUnique.mockResolvedValue({
            key: 'v3_47.600,-117.500,47.700,-117.300',
            data: mockOsmData,
            fetchedAt: thirtyOneDaysAgo
        });
        (global.fetch as jest.Mock).mockResolvedValueOnce({
            ok: true,
            json: async () => mockOsmData
        });

        const result = await fetchOSMData(mockBBox);

        expect(global.fetch).toHaveBeenCalled();
        expect(result.elements).toHaveLength(2);
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
            where: { key: expect.stringContaining('v3_') },
            create: expect.objectContaining({ data: mockOsmData })
        }));
    });

    it('warms memory cache from DB so second call skips both DB and network', async () => {
        mockFindUnique.mockResolvedValueOnce({
            key: 'v3_47.600,-117.500,47.700,-117.300',
            data: mockOsmData,
            fetchedAt: new Date()
        });

        await fetchOSMData(mockBBox); // warms memory cache from DB
        jest.clearAllMocks();
        mockFindUnique.mockResolvedValue(null); // DB would return null on next call

        const result = await fetchOSMData(mockBBox); // should hit memory cache

        expect(result.elements).toHaveLength(2);
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

        expect(result.elements).toHaveLength(2);
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
