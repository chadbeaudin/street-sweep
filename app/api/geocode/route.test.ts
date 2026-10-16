const mockJson = jest.fn();

jest.mock('next/server', () => ({ NextResponse: { json: mockJson } }));
jest.mock('@/lib/nominatim', () => ({ reverseAddress: jest.fn(), searchAddresses: jest.fn() }));

import { POST } from './route';
import { reverseAddress, searchAddresses } from '@/lib/nominatim';

const post = (body: unknown) => POST(new Request('http://localhost/api/geocode', { method: 'POST', body: JSON.stringify(body) })) as unknown as Promise<{ status: number; _data: unknown }>;

beforeEach(() => {
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
});
