const mockJson = jest.fn((data: any, init?: { status?: number }) => ({ status: init?.status ?? 200, _data: data }));
jest.mock('next/server', () => ({ NextResponse: { json: mockJson } }));
jest.mock('@/lib/strava', () => ({ fetchActivitiesForYear: jest.fn(), fetchGearFrameTypes: jest.fn() }));
jest.mock('@/lib/serverStravaCredentials', () => ({ resolveRequestStravaCredentials: jest.fn() }));

import { POST } from './route';
import { fetchActivitiesForYear, fetchGearFrameTypes } from '@/lib/strava';
import { resolveRequestStravaCredentials } from '@/lib/serverStravaCredentials';

const creds = { refreshToken: 'r' };
const post = (body: unknown) => POST(new Request('http://localhost/api/stats/year', { method: 'POST', body: JSON.stringify(body) }));
const lastResponse = () => mockJson.mock.calls[mockJson.mock.calls.length - 1];
const mtbRide = { id: 1, name: 'Ride', start_date: '2025-06-01T10:00:00Z', distance: 1609.344, total_elevation_gain: 0, type: 'Ride', gear_id: 'b1' };

beforeEach(() => {
    (resolveRequestStravaCredentials as jest.Mock).mockResolvedValue(creds);
    (fetchActivitiesForYear as jest.Mock).mockResolvedValue([mtbRide]);
    (fetchGearFrameTypes as jest.Mock).mockResolvedValue(new Map([['b1', 1]]));
});

describe('POST /api/stats/year', () => {
    it('rejects a caller with no Strava credentials', async () => {
        (resolveRequestStravaCredentials as jest.Mock).mockResolvedValue(null);
        await post({ year: 2025 });
        expect(lastResponse()[1]).toEqual({ status: 401 });
        expect(fetchActivitiesForYear).not.toHaveBeenCalled();
    });

    it.each([[undefined], ['2025'], [2025.5]])('rejects year %p', async year => {
        await post({ year });
        expect(lastResponse()[1]).toEqual({ status: 400 });
        expect(fetchActivitiesForYear).not.toHaveBeenCalled();
    });

    it('classifies a cycling year by the bike', async () => {
        await post({ year: 2025 });
        expect(fetchActivitiesForYear).toHaveBeenCalledWith(creds, 'cycling', 2025);
        expect(fetchGearFrameTypes).toHaveBeenCalledWith(creds, ['b1']);
        expect(lastResponse()[0].rides[0]).toMatchObject({ id: 1, mountainBike: true });
    });

    it('still returns the year when the gear lookup fails (#165)', async () => {
        (fetchGearFrameTypes as jest.Mock).mockRejectedValue(new Error('Failed to refresh Strava token: 429'));
        await post({ year: 2025 });
        expect(lastResponse()[1]).toBeUndefined();
        expect(lastResponse()[0].rides[0]).toMatchObject({ id: 1, mountainBike: false });
    });

    it('skips gear lookups for a running year', async () => {
        await post({ year: 2025, activityMode: 'running' });
        expect(fetchActivitiesForYear).toHaveBeenCalledWith(creds, 'running', 2025);
        expect(fetchGearFrameTypes).not.toHaveBeenCalled();
    });

    it('reports a failure as a 500', async () => {
        (fetchActivitiesForYear as jest.Mock).mockRejectedValue(new Error('Strava is temporarily unavailable'));
        await post({ year: 2025 });
        expect(lastResponse()).toEqual([{ error: 'Strava is temporarily unavailable' }, { status: 500 }]);
    });
});
