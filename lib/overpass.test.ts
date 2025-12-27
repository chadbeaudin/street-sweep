import { fetchOSMData } from './overpass';

describe('fetchOSMData robustness', () => {
    beforeEach(() => {
        global.fetch = jest.fn();
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    const mockBBox = { south: 40.0, west: -105.0, north: 40.1, east: -104.9 };

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
