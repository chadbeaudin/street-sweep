// Tests for issue #14: stack traces must not appear in error responses.

const mockJson = jest.fn((data: any, init?: { status?: number }) => ({
    status: init?.status ?? 200,
    _data: data,
}));

jest.mock('next/server', () => ({ NextResponse: { json: mockJson } }));
jest.mock('@/lib/overpass', () => ({ fetchOSMData: jest.fn() }));
jest.mock('@/lib/graph', () => ({
    StreetGraph: { getCachedGraph: jest.fn() },
    filterRiddenRoadsToBbox: jest.fn((riddenRoads: any) => riddenRoads ?? null),
}));
jest.mock('@/lib/elevation', () => ({ calculateElevationProfile: jest.fn() }));
jest.mock('@/lib/elevationFetch', () => ({ fetchElevationData: jest.fn() }));

import { POST } from './route';
import { fetchOSMData } from '@/lib/overpass';
import { StreetGraph } from '@/lib/graph';
import { calculateElevationProfile } from '@/lib/elevation';
import { fetchElevationData } from '@/lib/elevationFetch';
import * as metrics from '@/lib/metrics';

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

    it('does not expose the internal error message (#196)', async () => {
        mockedFetchOSM.mockRejectedValueOnce(new Error('Connection refused'));
        await POST(makeRequest({ bbox: validBbox }));
        const [data] = mockJson.mock.calls[0];
        expect(data.error).toMatch(/Map data unavailable/);
        expect(JSON.stringify(data)).not.toContain('Connection refused');
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

    it('does not fast-fail two nearby points just because the viewport bbox is huge', async () => {
        // Regression: the span check used to be computed from bufferedBbox, which
        // folds in the client's current map-viewport bbox alongside the points --
        // so a user zoomed out to a city/state view got rejected even though the
        // two points they actually clicked were only ~1km apart. The check must
        // look at the points/manualRoute extent only.
        mockedFetchOSM.mockResolvedValueOnce({ elements: [{ type: 'node', id: 1 }] } as any);
        await POST(makeRequest({
            bbox: { north: 40.5, south: 38.5, east: -103.5, west: -105.5 }, // ~220km-wide viewport
            manualRoute: [[-104.710, 39.020], [-104.715, 39.025]], // two points ~0.6km apart
        }));
        expect(mockedFetchOSM).toHaveBeenCalled();
    });

    it('rejects two points genuinely far apart even when the viewport bbox is small', async () => {
        // The inverse of the above: a tight viewport doesn't mask two points that
        // are actually ~96km apart -- the check must be based on the points, not bbox.
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

describe('POST /api/generate metrics (#117)', () => {
    it('records the route kind, its region, solve time and length', async () => {
        const recorded = jest.spyOn(metrics, 'recordGeneratedRoute');
        mockedFetchOSM.mockResolvedValueOnce({ elements: [{ type: 'node', id: 1 }] } as any);
        mockedGetCachedGraph.mockReturnValueOnce({ solveCPP: jest.fn().mockReturnValue([{ lat: 39.02, lon: -104.7 }]) } as any);
        mockedFetchElevation.mockResolvedValueOnce({ elevations: [0], sampledCoords: [[-104.7, 39.02]] } as any);
        mockedCalcElevationProfile.mockReturnValueOnce([{ distance: 7.5 } as any]);

        await POST(makeRequest({ bbox: validBbox, selectionBoxes: [{ north: 39.025, south: 39.015, east: -104.695, west: -104.705 }] }));

        expect(recorded).toHaveBeenCalledWith('area', expect.closeTo(39.02, 1), expect.closeTo(-104.7, 1), 7.5, expect.any(Number));
    });

    it('counts a point route rejected for spanning too far', async () => {
        const counted = jest.spyOn(metrics, 'incrementMetric');
        await POST(makeRequest({ bbox: validBbox, selectedPoints: [{ lat: 39.0, lon: -104.7 }, { lat: 40.5, lon: -104.7 }] }));
        expect(counted).toHaveBeenCalledWith('cpp.too_large.span');
    });

    it('counts an area rejected as too large', async () => {
        const counted = jest.spyOn(metrics, 'incrementMetric');
        mockedFetchOSM.mockResolvedValueOnce({ elements: [], skippedTooLarge: true } as any);
        await POST(makeRequest({ bbox: validBbox, selectionBoxes: [{ north: 39.6, south: 39.0, east: -104.0, west: -104.7 }] }));
        expect(counted).toHaveBeenCalledWith('cpp.too_large.area');
    });
});

describe('POST /api/generate draw order (#52)', () => {
    const boxA = { north: 39.022, south: 39.018, east: -104.702, west: -104.706 };
    const boxB = { north: 39.028, south: 39.024, east: -104.692, west: -104.696 };
    const selectedPoints = [{ lat: 39.02, lon: -104.71 }, { lat: 39.023, lon: -104.70 }, { lat: 39.03, lon: -104.69 }];
    const graphMock = () => {
        const graph = {
            solveCPP: jest.fn().mockReturnValue([{ lat: 39.02, lon: -104.7 }]),
            solveOrderedLegs: jest.fn().mockReturnValue([{ lat: 39.02, lon: -104.7 }]),
        };
        mockedFetchOSM.mockResolvedValueOnce({ elements: [{ type: 'node', id: 1 }] } as any);
        mockedGetCachedGraph.mockReturnValueOnce(graph as any);
        mockedFetchElevation.mockResolvedValueOnce({ elevations: [0], sampledCoords: [[-104.7, 39.02]] } as any);
        mockedCalcElevationProfile.mockReturnValueOnce([{ distance: 1 } as any]);
        return graph;
    };
    const body = { bbox: validBbox, selectedPoints, selectionBoxes: [boxA, boxB], manualSegments: [[], []], preAreaPointCount: 1 };

    it('rides areas in the order drawn when waypoints were placed between them', async () => {
        const graph = graphMock();
        await POST(makeRequest({ ...body, areaAnchors: { boxes: [1, 2], polygons: [] } }));

        expect(graph.solveCPP).not.toHaveBeenCalled();
        const [legs] = graph.solveOrderedLegs.mock.calls[0];
        expect(legs).toHaveLength(2);
        expect(legs[0]).toMatchObject({ approachStart: selectedPoints[0], boxes: [boxA], endPoint: selectedPoints[1] });
        expect(legs[1]).toMatchObject({ approachStart: selectedPoints[1], boxes: [boxB], endPoint: selectedPoints[2] });
    });

    it('keeps the single pass for areas drawn back to back', async () => {
        const graph = graphMock();
        await POST(makeRequest({ ...body, areaAnchors: { boxes: [1, 1], polygons: [] } }));
        expect(graph.solveCPP).toHaveBeenCalled();
        expect(graph.solveOrderedLegs).not.toHaveBeenCalled();
    });

    it('keeps the single pass for a request without draw order (an older open tab)', async () => {
        const graph = graphMock();
        await POST(makeRequest({ bbox: validBbox, selectedPoints, selectionBoxes: [boxA, boxB], preAreaPointCount: 1 }));
        expect(graph.solveCPP).toHaveBeenCalled();
        expect(graph.solveOrderedLegs).not.toHaveBeenCalled();
    });

    it('falls back to the single pass when the anchors do not match the areas sent', async () => {
        const graph = graphMock();
        await POST(makeRequest({ ...body, areaAnchors: { boxes: [1], polygons: [] } }));
        expect(graph.solveCPP).toHaveBeenCalled();
        expect(graph.solveOrderedLegs).not.toHaveBeenCalled();
    });

    it('rejects malformed draw order', async () => {
        mockJson.mockClear();
        await POST(makeRequest({ ...body, areaAnchors: { boxes: [-1, 2.5], polygons: [] } }));
        expect(mockJson.mock.calls[0][1]?.status).toBe(400);
    });
});
