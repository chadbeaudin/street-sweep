const mockJson = jest.fn((data: any, init?: { status?: number }) => ({ status: init?.status ?? 200, _data: data }));
jest.mock('next/server', () => ({ NextResponse: { json: mockJson } }));
jest.mock('@/lib/overpass', () => ({ fetchOSMData: jest.fn() }));

import { POST } from './route';
import { fetchOSMData } from '@/lib/overpass';
import { decodeRoads } from '@/lib/roadEncoding';

const bbox = { south: 47.65, west: -117.43, north: 47.66, east: -117.42 };
const post = (body: unknown) => POST(new Request('http://localhost/api/roads', { method: 'POST', body: JSON.stringify(body) }) as any);
const lastResponse = () => mockJson.mock.calls[mockJson.mock.calls.length - 1];

const street = { type: 'way', id: 1, tags: { highway: 'residential' }, geometry: [{ lat: 47.651, lon: -117.421 }, { lat: 47.652, lon: -117.422 }] };
const motorway = { type: 'way', id: 2, tags: { highway: 'motorway' }, geometry: [{ lat: 47.653, lon: -117.423 }, { lat: 47.654, lon: -117.424 }] };

beforeEach(() => {
    (fetchOSMData as jest.Mock).mockResolvedValue({ elements: [street, motorway] });
});

describe('POST /api/roads', () => {
    it('sends encoded polylines when the client asks for them (#181)', async () => {
        await post({ bbox, encoding: 'polyline5' });
        const [body] = lastResponse();
        expect(body.encoding).toBe('polyline5');
        expect(typeof body.roads[0]).toBe('string');
        expect(decodeRoads(body.roads)).toEqual([[[47.651, -117.421], [47.652, -117.422]]]);
    });

    it('still sends plain arrays to a client that does not ask (an old tab mid-deploy)', async () => {
        await post({ bbox });
        const [body] = lastResponse();
        expect(body.encoding).toBeUndefined();
        expect(body.roads).toEqual([[[47.651, -117.421], [47.652, -117.422]]]);
    });

    it('ignores an encoding it does not know', async () => {
        await post({ bbox, encoding: 'polyline9' });
        expect(Array.isArray(lastResponse()[0].roads[0])).toBe(true);
    });

    it('keeps leaving out motorways', async () => {
        await post({ bbox, encoding: 'polyline5' });
        expect(lastResponse()[0].roads).toHaveLength(1);
    });

    it('rejects a request without a bbox', async () => {
        await post({ encoding: 'polyline5' });
        expect(lastResponse()[1]).toEqual({ status: 400 });
    });

    it('rejects a malformed bbox without querying OSM (#193)', async () => {
        await post({ bbox: { ...bbox, north: 'x' } });
        expect(lastResponse()[1]).toEqual({ status: 400 });
        await post({ bbox: { south: 47.65, west: -117.43 } });
        expect(lastResponse()[1]).toEqual({ status: 400 });
        expect(fetchOSMData).not.toHaveBeenCalled();
    });
});
