const mockJson = jest.fn();
jest.mock('next/server', () => ({
    NextResponse: class {
        static json = mockJson;
        status: number;
        headers: Record<string, string>;
        constructor(public body: Buffer, init: { status: number; headers: Record<string, string> }) {
            this.status = init.status;
            this.headers = init.headers;
        }
    },
}));

import { POST } from './route';

const post = (body: unknown) => POST(new Request('http://localhost/api/export/fit', { method: 'POST', body: JSON.stringify(body) }) as any) as Promise<any>;
// Shaped like a generated route: [lon, lat, elevation, construction].
const ROUTE = [[-117.42, 47.65, 600, 0], [-117.43, 47.66, 610, 1]];

beforeEach(() => {
    mockJson.mockImplementation((data: unknown, init?: { status?: number }) => ({ status: init?.status ?? 200, _data: data }));
});

describe('POST /api/export/fit (#193)', () => {
    it('returns a FIT file named after the route', async () => {
        const res = await post({ route: ROUTE, name: 'Hill loop' });
        expect(res.status).toBe(200);
        expect(res.headers['Content-Disposition']).toBe('attachment; filename="Hill_loop.fit"');
        expect(res.body.byteLength).toBeGreaterThan(0);
    });

    it('rejects a malformed, too short or oversized route', async () => {
        expect((await post({ route: 'nope' })).status).toBe(400);
        expect((await post({ route: [ROUTE[0]] })).status).toBe(400);
        expect((await post({ route: [[0, NaN], [0, 0]] })).status).toBe(400);
        expect((await post({ route: Array.from({ length: 20_001 }, () => [0, 0]) })).status).toBe(400);
    });

    it('rejects an overlong name', async () => {
        expect((await post({ route: ROUTE, name: 'x'.repeat(201) })).status).toBe(400);
    });
});
