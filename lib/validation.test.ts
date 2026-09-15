import { z } from 'zod';
import { LatLon, BBox, CoordTuple, Polyline, PolylineList, parseBody } from './validation';

describe('validation primitives', () => {
    it('LatLon accepts finite lat/lon and rejects NaN/Infinity/missing fields', () => {
        expect(LatLon.safeParse({ lat: 40.1, lon: -105.2 }).success).toBe(true);
        expect(LatLon.safeParse({ lat: NaN, lon: -105.2 }).success).toBe(false);
        expect(LatLon.safeParse({ lat: Infinity, lon: -105.2 }).success).toBe(false);
        expect(LatLon.safeParse({ lat: 40.1 }).success).toBe(false);
    });

    it('BBox requires all four finite sides', () => {
        expect(BBox.safeParse({ north: 1, south: 0, east: 1, west: 0 }).success).toBe(true);
        expect(BBox.safeParse({ north: 1, south: 0, east: 1 }).success).toBe(false);
    });

    it('CoordTuple accepts 2 or 3 numbers, rejects 0/1/4', () => {
        expect(CoordTuple.safeParse([1, 2]).success).toBe(true);
        expect(CoordTuple.safeParse([1, 2, 3]).success).toBe(true);
        expect(CoordTuple.safeParse([1]).success).toBe(false);
        expect(CoordTuple.safeParse([1, 2, 3, 4]).success).toBe(false);
    });

    it('Polyline caps at 20,000 points', () => {
        const ok = Array.from({ length: 20_000 }, () => [0, 0]);
        const tooMany = Array.from({ length: 20_001 }, () => [0, 0]);
        expect(Polyline.safeParse(ok).success).toBe(true);
        expect(Polyline.safeParse(tooMany).success).toBe(false);
    });

    it('PolylineList caps at 2,000 polylines', () => {
        const tooMany = Array.from({ length: 2_001 }, () => [[0, 0]]);
        expect(PolylineList.safeParse(tooMany).success).toBe(false);
    });
});

describe('parseBody', () => {
    const schema = z.object({ foo: z.string() });

    it('returns data on valid JSON matching the schema', async () => {
        const req = new Request('http://localhost/x', { method: 'POST', body: JSON.stringify({ foo: 'bar' }) });
        const result = await parseBody(req, schema);
        expect('data' in result && result.data).toEqual({ foo: 'bar' });
    });

    it('returns a 400 NextResponse for malformed JSON', async () => {
        const req = new Request('http://localhost/x', { method: 'POST', body: '{not json' });
        const result = await parseBody(req, schema);
        expect('error' in result).toBe(true);
        if ('error' in result) expect(result.error.status).toBe(400);
    });

    it('returns a 400 NextResponse when the body fails schema validation', async () => {
        const req = new Request('http://localhost/x', { method: 'POST', body: JSON.stringify({ foo: 123 }) });
        const result = await parseBody(req, schema);
        expect('error' in result).toBe(true);
        if ('error' in result) expect(result.error.status).toBe(400);
    });
});
