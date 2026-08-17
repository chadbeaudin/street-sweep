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
});
