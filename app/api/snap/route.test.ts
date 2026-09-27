jest.mock('@/lib/overpass', () => ({
    fetchOSMData: jest.fn(() => { throw new Error('should not be called for invalid body'); }),
}));
jest.mock('@/lib/graph', () => ({
    StreetGraph: { getCachedGraph: jest.fn() },
}));

import { POST } from './route';

function req(body: unknown): Request {
    return new Request('http://localhost:3888/api/snap', { method: 'POST', body: JSON.stringify(body) });
}

describe('POST /api/snap', () => {
    it('rejects a body missing bbox with 400 before touching Overpass', async () => {
        const res = await POST(req({ point: { lat: 40, lon: -105 } }) as any);
        expect(res.status).toBe(400);
    });

    it('rejects non-finite coordinates with 400', async () => {
        const res = await POST(req({
            point: { lat: NaN, lon: -105 },
            bbox: { north: 1, south: 0, east: 1, west: 0 },
        }) as any);
        expect(res.status).toBe(400);
    });
});
