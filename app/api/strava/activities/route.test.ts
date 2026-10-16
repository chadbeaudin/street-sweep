// Tests for issue #14: stack traces must not appear in error responses.

const mockJson = jest.fn((data: any, init?: { status?: number }) => ({
    status: init?.status ?? 200,
    _data: data,
}));

jest.mock('next/server', () => ({ NextResponse: { json: mockJson } }));
jest.mock('@/lib/strava', () => ({
    fetchCyclingRiddenRoads: jest.fn(),
    forceSyncStravaActivities: jest.fn(),
}));
jest.mock('@/lib/serverStravaCredentials', () => ({ getSessionStravaCredentials: jest.fn() }));
jest.mock('next-auth', () => ({ getServerSession: jest.fn() }));
jest.mock('@/lib/auth', () => ({ authOptions: {} }));
jest.mock('@/lib/routeCredit', () => ({ creditMatchingActivities: jest.fn() }));

import { POST } from './route';
import { getServerSession } from 'next-auth';
import { creditMatchingActivities } from '@/lib/routeCredit';
import { fetchCyclingRiddenRoads, forceSyncStravaActivities } from '@/lib/strava';
import { getSessionStravaCredentials } from '@/lib/serverStravaCredentials';

const mockedFetch = fetchCyclingRiddenRoads as jest.MockedFunction<typeof fetchCyclingRiddenRoads>;
const mockedForceSync = forceSyncStravaActivities as jest.MockedFunction<typeof forceSyncStravaActivities>;
const mockedGetSessionCreds = getSessionStravaCredentials as jest.MockedFunction<typeof getSessionStravaCredentials>;

const mockedSession = getServerSession as jest.Mock;
const mockedCredit = creditMatchingActivities as jest.Mock;

beforeEach(() => {
    mockedGetSessionCreds.mockResolvedValue(null);
    mockedSession.mockResolvedValue(null);
    mockedCredit.mockResolvedValue(0);
});

const emptyRides = {
    riddenRoads: [], activityElevations: [], activityTypes: [],
    activityDistances: [], activityStartDates: [],
    totalCyclingActivities: 0, totalCyclingElevationGainMeters: 0,
};

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

    it('defaults to cycling mode when activityMode is omitted', async () => {
        mockedFetch.mockResolvedValueOnce({
            riddenRoads: [], activityElevations: [], activityTypes: [],
            activityDistances: [], activityStartDates: [],
            totalCyclingActivities: 0, totalCyclingElevationGainMeters: 0,
        });
        await POST(makeRequest({}));
        expect(mockedFetch).toHaveBeenCalledWith(undefined, 'cycling');
    });

    it('passes activityMode: "running" through to fetchCyclingRiddenRoads', async () => {
        mockedFetch.mockResolvedValueOnce({
            riddenRoads: [], activityElevations: [], activityTypes: [],
            activityDistances: [], activityStartDates: [],
            totalCyclingActivities: 0, totalCyclingElevationGainMeters: 0,
        });
        await POST(makeRequest({ activityMode: 'running' }));
        expect(mockedFetch).toHaveBeenCalledWith(undefined, 'running');
    });

    it('force-syncs Strava activities when requested', async () => {
        mockedFetch.mockResolvedValueOnce({
            riddenRoads: [], activityElevations: [], activityTypes: [],
            activityDistances: [], activityStartDates: [],
            totalCyclingActivities: 0, totalCyclingElevationGainMeters: 0,
        });
        const creds = { refreshToken: 'tok' };
        await POST(makeRequest({ stravaCredentials: creds, forceSync: true, activityMode: 'running' }));
        expect(mockedForceSync).toHaveBeenCalledWith(creds);
    });

    it('does not force-sync when the user did not request it', async () => {
        mockedFetch.mockResolvedValueOnce({
            riddenRoads: [], activityElevations: [], activityTypes: [],
            activityDistances: [], activityStartDates: [],
            totalCyclingActivities: 0, totalCyclingElevationGainMeters: 0,
        });
        await POST(makeRequest({ stravaCredentials: { refreshToken: 'tok' } }));
        expect(mockedForceSync).not.toHaveBeenCalled();
    });

    it('resolves the refresh token from the session when the client sends none (session-linked sign-in)', async () => {
        mockedFetch.mockResolvedValueOnce({
            riddenRoads: [], activityElevations: [], activityTypes: [],
            activityDistances: [], activityStartDates: [],
            totalCyclingActivities: 0, totalCyclingElevationGainMeters: 0,
        });
        mockedGetSessionCreds.mockResolvedValueOnce({ refreshToken: 'session-tok' });
        await POST(makeRequest({ stravaCredentials: { sessionLinked: true } }));
        expect(mockedFetch).toHaveBeenCalledWith(
            expect.objectContaining({ sessionLinked: true, refreshToken: 'session-tok' }),
            'cycling',
        );
    });

    it('never trusts a client-supplied refreshToken to skip session resolution silently -- session creds win when client sent none', async () => {
        mockedFetch.mockResolvedValueOnce({
            riddenRoads: [], activityElevations: [], activityTypes: [],
            activityDistances: [], activityStartDates: [],
            totalCyclingActivities: 0, totalCyclingElevationGainMeters: 0,
        });
        await POST(makeRequest({}));
        expect(mockedGetSessionCreds).toHaveBeenCalled();
    });

    it('credits matching rides for a signed-in user after syncing', async () => {
        mockedFetch.mockResolvedValueOnce(emptyRides);
        mockedSession.mockResolvedValueOnce({ user: { id: 'user-1' } });
        await POST(makeRequest({}));
        expect(mockedCredit).toHaveBeenCalledWith('user-1');
        expect(mockedFetch.mock.invocationCallOrder[0]).toBeLessThan(mockedCredit.mock.invocationCallOrder[0]);
    });

    it('does not try to credit rides without a signed-in user', async () => {
        mockedFetch.mockResolvedValueOnce(emptyRides);
        await POST(makeRequest({}));
        expect(mockedCredit).not.toHaveBeenCalled();
    });

    it('still returns rides when crediting fails', async () => {
        mockedFetch.mockResolvedValueOnce(emptyRides);
        mockedSession.mockResolvedValueOnce({ user: { id: 'user-1' } });
        mockedCredit.mockRejectedValueOnce(new Error('Strava down'));
        await POST(makeRequest({}));
        expect(mockJson.mock.calls[0][1]).toBeUndefined();
    });
});
