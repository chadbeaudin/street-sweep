const mockJson = jest.fn();
jest.mock('next/server', () => ({ NextResponse: { json: mockJson } }));

import { POST } from './route';
import * as metrics from '@/lib/metrics';
import { RATE_LIMITS, resetRateLimits } from '@/lib/rateLimit';

const post = (body: unknown, ip = '1.2.3.4') => POST(new Request('http://localhost/api/client-error', {
    method: 'POST', headers: { 'fly-client-ip': ip }, body: JSON.stringify(body),
})) as unknown as Promise<{ status: number }>;

beforeEach(() => {
    resetRateLimits();
    mockJson.mockImplementation((data: unknown, init?: { status?: number }) => ({ status: init?.status ?? 200, _data: data }));
});

describe('POST /api/client-error (#117)', () => {
    it('counts a known kind', async () => {
        const counted = jest.spyOn(metrics, 'incrementMetric');
        expect((await post({ kind: 'step' })).status).toBe(200);
        expect(counted).toHaveBeenCalledWith('client_error.step');
    });

    it('rejects unknown kinds, so callers cannot invent metric names', async () => {
        const counted = jest.spyOn(metrics, 'incrementMetric');
        expect((await post({ kind: 'anything.i.like' })).status).toBe(400);
        expect(counted.mock.calls.some(([name]) => String(name).startsWith('client_error'))).toBe(false);
    });

    it('is rate limited per client', async () => {
        for (let i = 0; i < RATE_LIMITS.clientError; i++) await post({ kind: 'step' });
        expect((await post({ kind: 'step' })).status).toBe(429);
        expect((await post({ kind: 'step' }, '5.6.7.8')).status).toBe(200);
    });
});
