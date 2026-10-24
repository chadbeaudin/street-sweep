const mockCheck = jest.fn();
jest.mock('@/lib/serviceHealth', () => ({ checkServices: () => mockCheck() }));
jest.mock('@/lib/metrics', () => ({ withApiMetrics: (_m: string, _r: string, h: unknown) => h }));
jest.mock('next/server', () => ({ NextResponse: { json: (data: unknown, init?: { headers?: Record<string, string> }) => ({ data, headers: init?.headers }) } }));

import { GET } from './route';

describe('GET /api/health (#129)', () => {
    it('returns the service status uncached', async () => {
        mockCheck.mockResolvedValue({ database: false, overpass: true, elevation: true });
        const res = await (GET as unknown as () => Promise<{ data: unknown; headers: Record<string, string> }>)();
        expect(res.data).toEqual({ services: { database: false, overpass: true, elevation: true } });
        expect(res.headers['Cache-Control']).toBe('no-store');
    });
});
