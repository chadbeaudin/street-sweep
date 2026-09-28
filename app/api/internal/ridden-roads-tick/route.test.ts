const mockJson = jest.fn((data: any, init?: { status?: number }) => ({
    status: init?.status ?? 200,
    _data: data,
}));

jest.mock('next/server', () => ({ NextResponse: { json: mockJson } }));

const mockTick = jest.fn();
jest.mock('@/lib/riddenRoadsWorkerJob', () => ({ tickRiddenRoadsWorker: (...args: any[]) => mockTick(...args) }));

import { POST } from './route';

function makeRequest(headers: Record<string, string> = {}): Request {
    return new Request('http://localhost/api/internal/ridden-roads-tick', { method: 'POST', headers });
}

describe('POST /api/internal/ridden-roads-tick', () => {
    const ORIGINAL_ENV = process.env;
    beforeEach(() => {
        jest.resetModules();
        process.env = { ...ORIGINAL_ENV, INTERNAL_WORKER_SECRET: 'test-secret' };
    });
    afterAll(() => { process.env = ORIGINAL_ENV; });

    it('rejects a request with no secret header', async () => {
        await POST(makeRequest());
        const [, init] = mockJson.mock.calls[0];
        expect(init?.status).toBe(404);
        expect(mockTick).not.toHaveBeenCalled();
    });

    it('rejects a request with the wrong secret', async () => {
        await POST(makeRequest({ 'x-internal-secret': 'wrong' }));
        const [, init] = mockJson.mock.calls[0];
        expect(init?.status).toBe(404);
        expect(mockTick).not.toHaveBeenCalled();
    });

    it('rejects every request when INTERNAL_WORKER_SECRET is unset, even a matching-looking header', async () => {
        delete process.env.INTERNAL_WORKER_SECRET;
        await POST(makeRequest({ 'x-internal-secret': '' }));
        const [, init] = mockJson.mock.calls[0];
        expect(init?.status).toBe(404);
        expect(mockTick).not.toHaveBeenCalled();
    });

    it('processes a tick when the secret matches', async () => {
        mockTick.mockResolvedValue({ processed: true, key: 'athlete-1' });
        await POST(makeRequest({ 'x-internal-secret': 'test-secret' }));
        expect(mockTick).toHaveBeenCalled();
        const [data, init] = mockJson.mock.calls[0];
        expect(init?.status).toBeUndefined();
        expect(data).toEqual({ processed: true, key: 'athlete-1' });
    });

    it('does not include a stack trace in the error response', async () => {
        mockTick.mockRejectedValue(new Error('db exploded'));
        await POST(makeRequest({ 'x-internal-secret': 'test-secret' }));
        const [data, init] = mockJson.mock.calls[0];
        expect(init?.status).toBe(500);
        expect(data.error).toBe('db exploded');
        expect(data).not.toHaveProperty('stack');
    });
});
