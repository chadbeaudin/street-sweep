// Tests for issue #14: stack traces must not appear in error responses.

const mockJson = jest.fn((data: any, init?: { status?: number }) => ({
    status: init?.status ?? 200,
    _data: data,
}));

jest.mock('next/server', () => ({ NextResponse: { json: mockJson } }));
jest.mock('@/lib/strava', () => ({ fetchCyclingRiddenRoads: jest.fn() }));

import { POST } from './route';
import { fetchCyclingRiddenRoads } from '@/lib/strava';

const mockedFetch = fetchCyclingRiddenRoads as jest.MockedFunction<typeof fetchCyclingRiddenRoads>;

function makeRequest(body: any): Request {
    return new Request('http://localhost/api/strava/activities', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
}

describe('POST /api/strava/activities', () => {
    it('returns riddenRoads on success', async () => {
        mockedFetch.mockResolvedValueOnce({
            riddenRoads: [[[0, 0], [1, 1]]],
            activityElevations: [0],
            activityTypes: ['Ride'],
            activityDistances: [1000],
            activityStartDates: ['2024-01-01T00:00:00Z'],
            totalCyclingActivities: 1,
            totalCyclingElevationGainMeters: 0,
        });
        await POST(makeRequest({}));
        const response = mockJson.mock.calls[0];
        expect(response[0]).toHaveProperty('riddenRoads');
        expect(response[1]).toBeUndefined();
    });

    it('does not include stack trace in error response', async () => {
        const err = new Error('Strava API failure');
        mockedFetch.mockRejectedValueOnce(err);
        await POST(makeRequest({}));
        const [data, init] = mockJson.mock.calls[0];
        expect(init?.status).toBe(500);
        expect(data).toHaveProperty('error');
        expect(data).not.toHaveProperty('trace');
        expect(data).not.toHaveProperty('stack');
    });

    it('does not expose internal error details beyond message', async () => {
        mockedFetch.mockRejectedValueOnce(new Error('Token expired'));
        await POST(makeRequest({}));
        const [data] = mockJson.mock.calls[0];
        expect(data.error).toBe('Token expired');
        expect(Object.keys(data)).toEqual(['error']);
    });
});
