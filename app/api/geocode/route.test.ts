const mockJson = jest.fn();

jest.mock('next/server', () => ({ NextResponse: { json: mockJson } }));
jest.mock('@/lib/nominatim', () => ({ reverseAddress: jest.fn(), searchAddresses: jest.fn() }));

import { POST } from './route';
import { reverseAddress, searchAddresses } from '@/lib/nominatim';
import { RATE_LIMITS, resetRateLimits } from '@/lib/rateLimit';

const post = (body: unknown, headers: Record<string, string> = {}) => POST(new Request('http://localhost/api/geocode', { method: 'POST', headers, body: JSON.stringify(body) })) as unknown as Promise<{ status: number; _data: unknown }>;

beforeEach(() => {
    resetRateLimits();
    mockJson.mockImplementation((data: unknown, init?: { status?: number }) => ({ status: init?.status ?? 200, _data: data }));
});

describe('POST /api/geocode', () => {
    it('looks up the street address for a point', async () => {
        (reverseAddress as jest.Mock).mockResolvedValue('123 Main St, Bend, Oregon');
        const res = await post({ lat: 44.05, lon: -121.31 });

        expect(reverseAddress).toHaveBeenCalledWith(44.05, -121.31);
        expect(res._data).toEqual({ label: '123 Main St, Bend, Oregon' });
    });

    it('searches addresses for a query', async () => {
        (searchAddresses as jest.Mock).mockResolvedValue([{ lat: 1, lon: 2, label: 'x' }]);
        const res = await post({ address: 'Bend', limit: 3 });

        expect(searchAddresses).toHaveBeenCalledWith('Bend', 3);
        expect(res._data).toEqual({ results: [{ lat: 1, lon: 2, label: 'x' }] });
    });

    it('rejects a request with neither a point nor an address', async () => {
        const res = await post({});
        expect(res.status).toBe(400);
    });

    it('rejects an oversized address or out-of-range limit and coordinates (#193)', async () => {
        expect((await post({ address: 'x'.repeat(201) })).status).toBe(400);
        expect((await post({ address: 'Bend', limit: 1000 })).status).toBe(400);
        expect((await post({ lat: 200, lon: 0 })).status).toBe(400);
        expect(searchAddresses).not.toHaveBeenCalled();
        expect(reverseAddress).not.toHaveBeenCalled();
    });

    it('answers 429 once a client exceeds its per-minute limit, without calling Nominatim (#193)', async () => {
        (searchAddresses as jest.Mock).mockResolvedValue([]);
        const ip = { 'fly-client-ip': '1.2.3.4' };
        for (let i = 0; i < RATE_LIMITS.geocode; i++) expect((await post({ address: 'Bend' }, ip)).status).toBe(200);

        expect((await post({ address: 'Bend' }, ip)).status).toBe(429);
        expect(searchAddresses).toHaveBeenCalledTimes(RATE_LIMITS.geocode);
        expect((await post({ address: 'Bend' }, { 'fly-client-ip': '5.6.7.8' })).status).toBe(200);
    });
});
