jest.mock('./prisma', () => ({
    prisma: {
        osmCache: {
            findUnique: jest.fn().mockResolvedValue(null),
            upsert: jest.fn().mockResolvedValue({}),
            delete: jest.fn().mockResolvedValue({}),
        }
    }
}));

jest.mock('./osmDiskCache', () => ({
    readDiskCache: jest.fn().mockResolvedValue(null),
    writeDiskCache: jest.fn().mockResolvedValue(undefined),
}));

import { fetchOSMData, resetCircuitBreakers } from './overpass';
import { readDiskCache } from './osmDiskCache';
import * as metrics from './metrics';

describe('fetchOSMData robustness', () => {
    beforeEach(() => {
        global.fetch = jest.fn();
        resetCircuitBreakers();
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    // Small bbox snapping to a single 0.05×0.05 tile (0.0025 sq deg) so 2-element
    // mock responses aren't rejected by the sparse-data guard (threshold > 0.003 sq deg).
    const mockBBox = { south: 40.01, west: -105.04, north: 40.04, east: -105.01 };

    it('returns empty fallback when ALL mirrors fail with 504 Gateway Timeout', async () => {
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

    it('returns empty fallback when ALL mirrors fail with 429 Too Many Requests', async () => {
        (global.fetch as jest.Mock).mockResolvedValue({
            ok: false,
            status: 429,
            statusText: 'Too Many Requests',
            text: async () => 'Too Many Requests'
        });

        const result = await fetchOSMData(mockBBox);
        expect(result.elements).toEqual([]);
        expect(result.generator).toBe('StreetSweep fallback');
    });

    it('parses successful response correctly', async () => {
        const mockResponse = {
            elements: [
                { type: 'node', id: 1, lat: 40.0, lon: -105.0 },
                { type: 'way', id: 2, nodes: [1] }
            ]
        };

        (global.fetch as jest.Mock).mockResolvedValueOnce({
            ok: true,
            json: async () => mockResponse
        });

        const data = await fetchOSMData(mockBBox);
        expect(data).toEqual(mockResponse);
    });
});

describe('fetchOSMData in-memory cache eviction', () => {
    beforeEach(() => {
        resetCircuitBreakers();
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    // Real-world bug (prod OOM crash): the in-memory OSM_CACHE Map was
    // unbounded, so every distinct tile fetched over a process's lifetime
    // stayed cached forever -- a single ridden-roads overlay recompute alone
    // touches ~1750 tiles. Verifies the cache now evicts its oldest entries
    // past a fixed cap instead of growing forever: fetch one more distinct
    // tile than the cap allows, then confirm the very first tile requires a
    // fresh network fetch again (it was evicted) while a tile fetched more
    // recently is still served from cache (no new network call).
    it('evicts the oldest entries once the cache exceeds its size cap, without erroring', async () => {
        const OSM_CACHE_MAX_ENTRIES = 2000;
        let fetchCount = 0;
        global.fetch = jest.fn(async () => {
            fetchCount++;
            return {
                ok: true,
                json: async () => ({ elements: [{ type: 'node', id: fetchCount, lat: 40, lon: -105 }] }),
            };
        }) as any;

        // Small, tile-aligned bboxes (0.005° apart) so each gets a distinct
        // cache key, staying under the sparse-data guard (< 0.003 sq deg).
        const bboxAt = (i: number) => ({ south: 40 + i * 0.01, west: -105 - i * 0.01, north: 40.0025 + i * 0.01, east: -104.9975 - i * 0.01 });

        for (let i = 0; i < OSM_CACHE_MAX_ENTRIES + 1; i++) {
            await fetchOSMData(bboxAt(i));
        }
        expect(fetchCount).toBe(OSM_CACHE_MAX_ENTRIES + 1);

        // The very first tile should have been evicted -- refetching it hits
        // the network again (disk/DB cache is mocked empty in this file).
        await fetchOSMData(bboxAt(0));
        expect(fetchCount).toBe(OSM_CACHE_MAX_ENTRIES + 2);

        // The most recently fetched tile is still in cache -- no new network call.
        await fetchOSMData(bboxAt(OSM_CACHE_MAX_ENTRIES));
        expect(fetchCount).toBe(OSM_CACHE_MAX_ENTRIES + 2);
    });
});

describe('fetchOSMData sparse-floor trust for self-hosted Overpass', () => {
    const selfHostedUrl = 'https://self-hosted.test/api/interpreter';
    // A large-enough bbox (> 0.003 sq deg) to trigger the sparse-floor guard.
    const largeBBox = { south: 44.05, west: -121.35, north: 44.15, east: -121.15 };

    beforeEach(() => {
        jest.resetModules();
        process.env.OVERPASS_URL = selfHostedUrl;
        global.fetch = jest.fn();
    });

    afterEach(() => {
        delete process.env.OVERPASS_URL;
        jest.restoreAllMocks();
    });

    it('trusts a low-element response from the self-hosted mirror instead of cascading to public mirrors', async () => {
        const { fetchOSMData: fetchWithSelfHosted, resetCircuitBreakers: reset } = require('./overpass');
        reset();

        const sparseButRealResponse = { elements: [{ type: 'way', id: 1, nodes: [] }] }; // 1 elem, well under any urban floor
        (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: true, json: async () => sparseButRealResponse });

        const data = await fetchWithSelfHosted(largeBBox);
        expect(data).toEqual(sparseButRealResponse);
        expect(global.fetch).toHaveBeenCalledTimes(1); // no cascade to other mirrors
    });

    it('trusts a zero-element response from the self-hosted mirror without opening its circuit', async () => {
        const { fetchOSMData: fetchWithSelfHosted, resetCircuitBreakers: reset } = require('./overpass');
        reset();

        const roadless = { elements: [] };
        const nonEmpty = { elements: [{ type: 'way', id: 2, nodes: [] }] };
        (global.fetch as jest.Mock)
            .mockResolvedValueOnce({ ok: true, json: async () => roadless })
            .mockResolvedValueOnce({ ok: true, json: async () => nonEmpty });

        expect(await fetchWithSelfHosted(largeBBox)).toEqual(roadless);
        expect(global.fetch).toHaveBeenCalledTimes(1); // no cascade to public mirrors

        // The next request still goes to the self-hosted mirror rather than skipping it.
        const otherBBox = { south: 45.05, west: -121.35, north: 45.15, east: -121.15 };
        expect(await fetchWithSelfHosted(otherBBox)).toEqual(nonEmpty);
        expect((global.fetch as jest.Mock).mock.calls[1][0]).toBe(selfHostedUrl);
    });
});

describe('fetchOSMData metrics (#117)', () => {
    beforeEach(() => {
        global.fetch = jest.fn();
        resetCircuitBreakers();
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    it('records a network miss and Overpass call, then a memory hit for the same tile', async () => {
        const lookups = jest.spyOn(metrics, 'recordCacheLookup');
        const calls = jest.spyOn(metrics, 'recordExternalCall');
        (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ elements: [{ type: 'node', id: 1, lat: 41.0, lon: -106.0 }] }) });
        const bbox = { south: 41.001, west: -106.004, north: 41.003, east: -106.002 };

        await fetchOSMData(bbox);
        await fetchOSMData(bbox);

        expect(lookups.mock.calls).toEqual([['osm', 'miss'], ['osm', 'memory']]);
        expect(calls).toHaveBeenCalledWith('overpass', 'ok');
        expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    it('records a disk hit', async () => {
        const lookups = jest.spyOn(metrics, 'recordCacheLookup');
        (readDiskCache as jest.Mock).mockResolvedValueOnce({ elements: [{ type: 'node', id: 1, lat: 42.0, lon: -107.0 }] });
        await fetchOSMData({ south: 42.001, west: -107.004, north: 42.003, east: -107.002 });
        expect(lookups).toHaveBeenCalledWith('osm', 'disk');
    });

    it('records rate-limited mirrors and their circuits opening', async () => {
        const calls = jest.spyOn(metrics, 'recordExternalCall');
        const breakers = jest.spyOn(metrics, 'recordExternalBreaker');
        (global.fetch as jest.Mock).mockResolvedValue({ ok: false, status: 429, text: async () => 'slow down' });
        await fetchOSMData({ south: 43.001, west: -108.004, north: 43.003, east: -108.002 });
        expect(calls).toHaveBeenCalledWith('overpass', 'rate_limited');
        expect(breakers).toHaveBeenCalledWith('overpass');
    });
});
