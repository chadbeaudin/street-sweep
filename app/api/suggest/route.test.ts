const mockJson = jest.fn((data: any, init?: { status?: number }) => ({ status: init?.status ?? 200, _data: data }));
jest.mock('next/server', () => ({ NextResponse: { json: mockJson } }));
jest.mock('@/lib/strava', () => ({ fetchRideTracks: jest.fn() }));
jest.mock('@/lib/serverStravaCredentials', () => ({ resolveRequestStravaCredentials: jest.fn() }));
jest.mock('@/lib/overpass', () => ({ fetchOSMData: jest.fn() }));
jest.mock('@/lib/elevationFetch', () => ({ fetchElevationData: jest.fn() }));
jest.mock('@/lib/suggestLoop', () => ({ planLoop: jest.fn(), loopReachM: jest.fn(), measureGainM: jest.fn() }));
jest.mock('@/lib/graph', () => ({
    StreetGraph: { getCachedGraph: jest.fn(), reuseKey: jest.fn() },
    filterRiddenRoadsToBbox: jest.fn(),
}));

import { POST } from './route';
import { fetchRideTracks } from '@/lib/strava';
import { resolveRequestStravaCredentials } from '@/lib/serverStravaCredentials';
import { fetchOSMData } from '@/lib/overpass';
import { planLoop, loopReachM, measureGainM } from '@/lib/suggestLoop';
import { StreetGraph, filterRiddenRoadsToBbox } from '@/lib/graph';

const HOME = { lat: 47.65, lon: -117.42 };
const post = (body: unknown) => POST(new Request('http://localhost/api/suggest', { method: 'POST', body: JSON.stringify(body) }));
const lastResponse = () => mockJson.mock.calls[mockJson.mock.calls.length - 1];

const track = (id: number, name: string, at = HOME) => ({
    id, name, startDate: `2026-10-0${id}T00:00:00Z`, distanceM: 30_000, elevationGainM: 400,
    poly: [[at.lat, at.lon], [at.lat + 0.05, at.lon], [at.lat, at.lon]] as [number, number][],
});
const graph = { buildRiddenPenaltyMap: jest.fn() };
const loopPath: [number, number][] = Array.from({ length: 31 }, (_, k) => [HOME.lat + 0.13 * Math.sin(Math.PI * k / 30), HOME.lon]);

beforeEach(() => {
    (resolveRequestStravaCredentials as jest.Mock).mockResolvedValue({ refreshToken: 'r', athleteId: '1' });
    (fetchRideTracks as jest.Mock).mockResolvedValue([track(1, 'Usual'), track(2, 'Usual')]);
    (StreetGraph.getCachedGraph as jest.Mock).mockReturnValue(graph);
    (StreetGraph.reuseKey as jest.Mock).mockReturnValue('key');
    (filterRiddenRoadsToBbox as jest.Mock).mockImplementation((roads: unknown) => roads);
    (fetchOSMData as jest.Mock).mockResolvedValue({ elements: [] });
    (loopReachM as jest.Mock).mockReturnValue(5000);
    (measureGainM as jest.Mock).mockResolvedValue(350);
    graph.buildRiddenPenaltyMap.mockReturnValue(new Map());
    (planLoop as jest.Mock).mockResolvedValue({ path: loopPath, distanceM: 29_000, gainM: 380, unriddenFraction: 0.7, score: 0 });
});

describe('POST /api/suggest (#80)', () => {
    it('rejects a caller who is not signed in with Strava', async () => {
        (resolveRequestStravaCredentials as jest.Mock).mockResolvedValue(null);
        await post({ start: HOME });
        expect(lastResponse()[1]).toEqual({ status: 401 });
        expect(fetchRideTracks).not.toHaveBeenCalled();
    });

    it('rejects a missing start', async () => {
        await post({});
        expect(lastResponse()[1]).toEqual({ status: 400 });
    });

    it("plans a loop for the usual ride's distance and climbing and returns it as waypoints from the start", async () => {
        await post({ start: HOME, routingOptions: { pointRoutePenalty: 6 } });
        // The usual ride's climbing is measured like the candidates', not taken from Strava.
        expect(measureGainM).toHaveBeenCalledWith(track(1, 'Usual').poly, expect.any(Function));
        expect(planLoop).toHaveBeenCalledWith(graph, HOME, { distanceM: 30_000, gainM: 350 }, expect.any(Map), expect.any(Function));
        expect(graph.buildRiddenPenaltyMap).toHaveBeenCalledWith(6);
        const data = lastResponse()[0];
        expect(data).toMatchObject({ distanceM: 29_000, gainM: 380, usual: { rideName: 'Usual', timesRidden: 2, distanceM: 30_000 } });
        expect(data.waypoints[0]).toEqual(HOME);
        expect(data.waypoints[data.waypoints.length - 1]).toEqual(HOME);
        expect(data.waypoints.length).toBeGreaterThan(8);
    });

    it("marks the rider's ridden streets and keeps the street fetch under the Overpass size limit", async () => {
        await post({ start: HOME });
        const bbox = (fetchOSMData as jest.Mock).mock.calls[0][0];
        expect(bbox.north - bbox.south).toBeLessThanOrEqual(0.45);
        expect(bbox.east - bbox.west).toBeLessThanOrEqual(0.45);
        expect((StreetGraph.getCachedGraph as jest.Mock).mock.calls[0][2]).toHaveLength(2);
    });

    it('uses rides from anywhere when none start nearby', async () => {
        (fetchRideTracks as jest.Mock).mockResolvedValue([track(1, 'Far away', { lat: 40.76, lon: -111.89 })]);
        await post({ start: HOME, activityMode: 'running' });
        expect(lastResponse()[0].usual.rideName).toBe('Far away');
        expect(fetchRideTracks).toHaveBeenCalledWith(expect.anything(), 'running');
    });

    it('says so when there are no rides, or no streets to plan on', async () => {
        (fetchRideTracks as jest.Mock).mockResolvedValue([]);
        await post({ start: HOME });
        expect(lastResponse()[1]).toEqual({ status: 404 });
        (fetchRideTracks as jest.Mock).mockResolvedValue([track(1, 'Usual')]);
        (planLoop as jest.Mock).mockResolvedValue(null);
        await post({ start: HOME });
        expect(lastResponse()[1]).toEqual({ status: 404 });
    });
});
