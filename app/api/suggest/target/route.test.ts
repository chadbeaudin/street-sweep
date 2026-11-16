const mockJson = jest.fn();
jest.mock('next/server', () => ({ NextResponse: { json: mockJson } }));
jest.mock('@/lib/strava', () => ({ fetchRideTracks: jest.fn() }));
jest.mock('@/lib/serverStravaCredentials', () => ({ resolveRequestStravaCredentials: jest.fn() }));

import { POST } from './route';
import { fetchRideTracks } from '@/lib/strava';
import { resolveRequestStravaCredentials } from '@/lib/serverStravaCredentials';

const post = (body: unknown) => POST(new Request('http://localhost/api/suggest/target', { method: 'POST', body: JSON.stringify(body) }));
const lastResponse = () => mockJson.mock.calls[mockJson.mock.calls.length - 1];
const track = (distanceM: number, elevationGainM: number) => ({
    id: distanceM, name: 'Ride', startDate: '2026-10-01T00:00:00Z', distanceM, elevationGainM,
    poly: [[47.65, -117.42], [47.7, -117.42]] as [number, number][],
});

beforeEach(() => {
    jest.clearAllMocks();
    mockJson.mockImplementation((data: unknown, init?: { status?: number }) => ({ data, init }));
    (resolveRequestStravaCredentials as jest.Mock).mockResolvedValue({ refreshToken: 'r', athleteId: '1' });
});

describe('POST /api/suggest/target (#237)', () => {
    it("returns the distance and climbing of the rider's typical ride", async () => {
        (fetchRideTracks as jest.Mock).mockResolvedValue([track(10_000, 100), track(34_000, 390), track(60_000, 900)]);
        await post({ activityMode: 'cycling' });
        expect(lastResponse()[0]).toEqual({ distanceM: 34_000, elevationGainM: 390 });
    });

    it('rejects a caller who is not signed in with Strava', async () => {
        (resolveRequestStravaCredentials as jest.Mock).mockResolvedValue(null);
        await post({});
        expect(lastResponse()[1]).toEqual({ status: 401 });
        expect(fetchRideTracks).not.toHaveBeenCalled();
    });

    it('says so when there are no rides', async () => {
        (fetchRideTracks as jest.Mock).mockResolvedValue([]);
        await post({});
        expect(lastResponse()[1]).toEqual({ status: 404 });
    });
});
