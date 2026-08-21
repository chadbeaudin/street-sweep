// Tests for issue #14: stack traces must not appear in error responses.

const mockJson = jest.fn((data: any, init?: { status?: number }) => ({
    status: init?.status ?? 200,
    _data: data,
}));

jest.mock('next/server', () => ({ NextResponse: { json: mockJson } }));
jest.mock('@/lib/overpass', () => ({ fetchOSMData: jest.fn() }));
jest.mock('@/lib/graph', () => ({ StreetGraph: { getCachedGraph: jest.fn() } }));
jest.mock('@/lib/elevation', () => ({
    fetchElevationData: jest.fn(),
    calculateElevationProfile: jest.fn(),
}));

import { POST } from './route';
import { fetchOSMData } from '@/lib/overpass';

const mockedFetchOSM = fetchOSMData as jest.MockedFunction<typeof fetchOSMData>;

const validBbox = { north: 39.03, south: 39.01, east: -104.69, west: -104.71 };

function makeRequest(body: any): Request {
    return new Request('http://localhost/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
}

describe('POST /api/generate', () => {
    it('returns 400 for missing bbox', async () => {
        await POST(makeRequest({}));
        const [data, init] = mockJson.mock.calls[0];
        expect(init?.status).toBe(400);
        expect(data).toHaveProperty('error');
    });

    it('does not include stack trace when an internal error occurs', async () => {
        mockedFetchOSM.mockRejectedValueOnce(new Error('OSM fetch failed'));
        await POST(makeRequest({ bbox: validBbox }));
        const [data, init] = mockJson.mock.calls[0];
        expect(init?.status).toBe(500);
        expect(data).toHaveProperty('error');
        expect(data).not.toHaveProperty('trace');
        expect(data).not.toHaveProperty('stack');
    });

    it('does not expose internal error details beyond message', async () => {
        mockedFetchOSM.mockRejectedValueOnce(new Error('Connection refused'));
        await POST(makeRequest({ bbox: validBbox }));
        const [data] = mockJson.mock.calls[0];
        expect(data.error).toBe('Connection refused');
        expect(data.degraded).toBe(true);
        expect(Object.keys(data)).toEqual(expect.arrayContaining(['error', 'degraded']));
    });

    it('fails fast with a specific message for point-to-point routing across a long distance, without calling fetchOSMData', async () => {
        // Two points ~70km apart (> 0.5° span), no drawn area — should be rejected before any OSM fetch.
        await POST(makeRequest({
            bbox: { north: 39.03, south: 39.01, east: -104.69, west: -104.71 },
            manualRoute: [[-104.70, 39.02], [-104.00, 39.70]],
        }));
        const [data, init] = mockJson.mock.calls[0];
        expect(init?.status).toBe(400);
        expect(data.error).toMatch(/too far apart/i);
        expect(mockedFetchOSM).not.toHaveBeenCalled();
    });

    it('does not fast-fail a large drawn-area selection (only applies to pure point-to-point)', async () => {
        mockedFetchOSM.mockResolvedValueOnce({ elements: [{ type: 'node', id: 1 }] } as any);
        await POST(makeRequest({
            bbox: { north: 39.03, south: 39.01, east: -104.69, west: -104.71 },
            selectionBoxes: [{ north: 39.30, south: 39.02, east: -104.40, west: -104.70 }],
        }));
        expect(mockedFetchOSM).toHaveBeenCalled();
    });
});
