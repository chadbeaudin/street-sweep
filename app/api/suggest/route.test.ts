const mockJson = jest.fn((data: any, init?: { status?: number }) => ({ status: init?.status ?? 200, _data: data }));
jest.mock('next/server', () => ({ NextResponse: { json: mockJson } }));
jest.mock('@/lib/strava', () => ({ fetchRideTracks: jest.fn() }));
jest.mock('@/lib/serverStravaCredentials', () => ({ resolveRequestStravaCredentials: jest.fn() }));

import { POST } from './route';
import { fetchRideTracks } from '@/lib/strava';
import { resolveRequestStravaCredentials } from '@/lib/serverStravaCredentials';

const HOME = { lat: 47.65, lon: -117.42 };
const post = (body: unknown) => POST(new Request('http://localhost/api/suggest', { method: 'POST', body: JSON.stringify(body) }));
const lastResponse = () => mockJson.mock.calls[mockJson.mock.calls.length - 1];

// A ~6 km out-and-back north of home.
const track = (id: number, name: string) => ({
    id, name, startDate: `2026-10-0${id}T00:00:00Z`, distanceM: 6000,
    poly: [[HOME.lat, HOME.lon], [HOME.lat + 0.027, HOME.lon], [HOME.lat, HOME.lon]] as [number, number][],
});

beforeEach(() => {
    (resolveRequestStravaCredentials as jest.Mock).mockResolvedValue({ refreshToken: 'r', athleteId: '1' });
    (fetchRideTracks as jest.Mock).mockResolvedValue([track(1, 'Hill repeat'), track(2, 'Hill repeat')]);
});

describe('POST /api/suggest (#80)', () => {
    it('rejects a caller who is not signed in with Strava', async () => {
        (resolveRequestStravaCredentials as jest.Mock).mockResolvedValue(null);
        await post({ mapCenter: HOME });
        expect(lastResponse()[1]).toEqual({ status: 401 });
        expect(fetchRideTracks).not.toHaveBeenCalled();
    });

    it('rejects a missing map centre', async () => {
        await post({});
        expect(lastResponse()[1]).toEqual({ status: 400 });
    });

    it('returns waypoints along the most common ride, closing the loop at its start', async () => {
        await post({ mapCenter: HOME, home: HOME });
        const data = lastResponse()[0];
        expect(data).toMatchObject({ rideName: 'Hill repeat', timesRidden: 2 });
        expect(data.distanceMiles).toBeCloseTo(3.73, 1);
        expect(data.waypoints[0]).toEqual(HOME);
        expect(data.waypoints[data.waypoints.length - 1]).toEqual(HOME);
        expect(data.waypoints.length).toBeGreaterThan(3);
        expect(fetchRideTracks).toHaveBeenCalledWith({ refreshToken: 'r', athleteId: '1' }, 'cycling');
    });

    it('says so when no ride starts near the anchor', async () => {
        await post({ mapCenter: { lat: 40.76, lon: -111.89 }, home: null, activityMode: 'running' });
        expect(lastResponse()[1]).toEqual({ status: 404 });
        expect(fetchRideTracks).toHaveBeenCalledWith(expect.anything(), 'running');
    });
});
