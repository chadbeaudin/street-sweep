jest.mock('./prisma', () => ({ prisma: {} }));

import { reverseAddress, searchAddresses } from './nominatim';
import { reverseGeocode } from './nominatim';
import * as metrics from './metrics';

const fetchMock = jest.fn();

beforeEach(() => {
    global.fetch = fetchMock as unknown as typeof fetch;
});

describe('reverseAddress', () => {
    it('returns the street-level address for a point', async () => {
        fetchMock.mockResolvedValue({ ok: true, json: async () => ({ display_name: '123 Main St, Bend, Oregon' }) });

        expect(await reverseAddress(44.05, -121.31)).toBe('123 Main St, Bend, Oregon');
        expect(fetchMock.mock.calls[0][0]).toContain('/reverse?lat=44.05&lon=-121.31&format=json&zoom=18');
    });

    it('returns null when no address is found', async () => {
        fetchMock.mockResolvedValue({ ok: false, status: 404 });
        expect(await reverseAddress(0, 0)).toBeNull();
    });
});

describe('nominatim metrics (#117)', () => {
    it('records a geocode cache miss and the Nominatim call, then a memory hit', async () => {
        const lookups = jest.spyOn(metrics, 'recordCacheLookup');
        const calls = jest.spyOn(metrics, 'recordExternalCall');
        fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => ({ address: { city: 'Bend' } }) });

        await reverseGeocode(44.05, -121.31);
        await reverseGeocode(44.05, -121.31);

        expect(lookups.mock.calls).toEqual([['geocode', 'miss'], ['geocode', 'memory']]);
        expect(calls.mock.calls).toEqual([['nominatim', 'ok']]);
    });

    it('records a rate limit and a network failure', async () => {
        const calls = jest.spyOn(metrics, 'recordExternalCall');
        fetchMock.mockResolvedValueOnce({ ok: false, status: 429 });
        await expect(reverseAddress(1, 1)).rejects.toThrow('429');
        fetchMock.mockRejectedValueOnce(new TypeError('fetch failed'));
        await expect(reverseAddress(2, 2)).rejects.toThrow('fetch failed');
        expect(calls.mock.calls).toEqual([['nominatim', 'rate_limited'], ['nominatim', 'error']]);
    });
});

describe('searchAddresses', () => {
    const respond = (results: { lat: string; lon: string; display_name: string }[]) => ({ ok: true, json: async () => results });
    const spokane = { lat: '47.63', lon: '-117.40', display_name: 'South Grand Boulevard, Spokane, Washington' };
    const chicago = { lat: '41.81', lon: '-87.62', display_name: 'Grand Boulevard, Chicago, Illinois' };

    beforeEach(() => fetchMock.mockReset());

    it('looks near the map first, inside a box about 70 miles around it', async () => {
        fetchMock.mockResolvedValueOnce(respond([spokane]));
        const results = await searchAddresses('Grand Blvd', 5, { lat: 47.65, lon: -117.42 });
        expect(results.map(r => r.label)).toEqual(['South Grand Boulevard, Spokane, Washington']);
        expect(fetchMock).toHaveBeenCalledTimes(1);
        const url = fetchMock.mock.calls[0][0] as string;
        expect(url).toContain('&bounded=1');
        const [west, north, east, south] = decodeURIComponent(url.match(/viewbox=([^&]+)/)![1]).split(',').map(Number);
        expect(north - south).toBeCloseTo(2, 5);
        expect(west).toBeLessThan(-117.42);
        expect(east).toBeGreaterThan(-117.42);
    }, 10000);

    it('searches everywhere when nothing nearby matches', async () => {
        fetchMock.mockResolvedValueOnce(respond([])).mockResolvedValueOnce(respond([chicago]));
        const results = await searchAddresses('Grand Blvd Chicago', 5, { lat: 47.65, lon: -117.42 });
        expect(results.map(r => r.label)).toEqual(['Grand Boulevard, Chicago, Illinois']);
        expect(fetchMock.mock.calls[1][0]).not.toContain('viewbox');
    }, 10000);

    it('searches everywhere when it does not know where the rider is', async () => {
        fetchMock.mockResolvedValueOnce(respond([chicago]));
        await searchAddresses('Grand Blvd', 5);
        expect(fetchMock.mock.calls[0][0]).not.toContain('viewbox');
    }, 10000);
});
