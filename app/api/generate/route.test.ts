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
import { StreetGraph } from '@/lib/graph';
import { fetchElevationData, calculateElevationProfile } from '@/lib/elevation';

const mockedFetchOSM = fetchOSMData as jest.MockedFunction<typeof fetchOSMData>;
const mockedGetCachedGraph = StreetGraph.getCachedGraph as jest.MockedFunction<typeof StreetGraph.getCachedGraph>;
const mockedFetchElevation = fetchElevationData as jest.MockedFunction<typeof fetchElevationData>;
const mockedCalcElevationProfile = calculateElevationProfile as jest.MockedFunction<typeof calculateElevationProfile>;

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

    it('does not pass the pre-area waypoint as endPoint for a lasso-only selection with no post-area point yet', async () => {
        // A lasso (selectionPolygons, no selectionBoxes) drawn right after a 2-point
        // route, with no waypoint added past it yet. combinedSelections only tracks
        // boxes, so a lasso-only selection previously fell through to "no area
        // selected" and defaulted endPoint to the last real waypoint (the point
        // just before the lasso) — sending the area's own coverage trail back at
        // its own entry point instead of sweeping away from it.
        mockedFetchOSM.mockResolvedValueOnce({ elements: [{ type: 'node', id: 1 }] } as any);
        const solveCPPSpy = jest.fn().mockReturnValue([{ lat: 1, lon: 1 }]);
        mockedGetCachedGraph.mockReturnValueOnce({ solveCPP: solveCPPSpy } as any);
        mockedFetchElevation.mockResolvedValueOnce({ elevations: [0], sampledCoords: [[1, 1]] } as any);
        mockedCalcElevationProfile.mockReturnValueOnce([{ distance: 0 } as any]);

        const selectedPoints = [
            { lat: 39.02, lon: -104.71 }, // A
            { lat: 39.025, lon: -104.705 }, // B — last real point, entry to the lasso
        ];
        await POST(makeRequest({
            bbox: validBbox,
            manualRoute: [[-104.71, 39.02], [-104.705, 39.025]],
            selectedPoints,
            preAreaPointCount: selectedPoints.length,
            selectionPolygons: [[[39.02, -104.71], [39.03, -104.71], [39.03, -104.69], [39.02, -104.69]]],
        }));

        expect(solveCPPSpy).toHaveBeenCalled();
        const endPointArg = solveCPPSpy.mock.calls[0][1];
        expect(endPointArg).toBeUndefined();
    });
});
