const mockJson = jest.fn((data: any, init?: { status?: number }) => ({
    status: init?.status ?? 200,
    _data: data,
}));

jest.mock('next/server', () => ({ NextResponse: { json: mockJson } }));
jest.mock('garmin-connect', () => ({
    GarminConnect: jest.fn().mockImplementation(() => ({
        login: jest.fn(),
        client: { post: jest.fn().mockResolvedValue({}) },
    })),
}));
jest.mock('@/lib/geometry', () => ({ haversineM: jest.fn(() => 100) }));

import { POST } from './route';
import { GarminConnect } from 'garmin-connect';
import { haversineM } from '@/lib/geometry';

beforeEach(() => {
    (haversineM as jest.Mock).mockReturnValue(100);
});

function makeRequest(body: any): Request {
    return new Request('http://localhost/api/export/garmin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
}

// Returns the mock post spy and the captured payload after calling POST
async function callAndCapture(route: any[], name = 'Test') {
    const mockPost = jest.fn().mockResolvedValue({});
    (GarminConnect as jest.Mock).mockImplementationOnce(() => ({
        login: jest.fn(),
        client: { post: mockPost },
    }));
    await POST(makeRequest({ route, name, email: 'a@b.com', password: 'pw' }));
    const [url, payload] = mockPost.mock.calls[0];
    return { url, payload, mockPost };
}

// ── Validation ────────────────────────────────────────────────────────────────

describe('POST /api/export/garmin — validation', () => {
    it('returns 400 when password is missing', async () => {
        await POST(makeRequest({ route: [[-104.7, 39.02, 100]], email: 'a@b.com' }));
        expect(mockJson.mock.calls[0][1]?.status).toBe(400);
    });

    it('returns 400 when email is missing', async () => {
        await POST(makeRequest({ route: [[-104.7, 39.02, 100]], password: 'pw' }));
        expect(mockJson.mock.calls[0][1]?.status).toBe(400);
    });
});

// ── Security ─────────────────────────────────────────────────────────────────

describe('POST /api/export/garmin — security', () => {
    it('does not include password in error response', async () => {
        (GarminConnect as jest.Mock).mockImplementationOnce(() => ({
            login: jest.fn().mockRejectedValue(new Error('Invalid credentials')),
            client: { post: jest.fn() },
        }));
        await POST(makeRequest({ route: [[-104.7, 39.02, 100]], email: 'a@b.com', password: 'my_secret' }));
        expect(JSON.stringify(mockJson.mock.calls[0][0])).not.toContain('my_secret');
    });

    it('does not log password on error', async () => {
        const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
        (GarminConnect as jest.Mock).mockImplementationOnce(() => ({
            login: jest.fn().mockRejectedValue(new Error('Auth failed')),
            client: { post: jest.fn() },
        }));
        await POST(makeRequest({ route: [[-104.7, 39.02, 100]], email: 'a@b.com', password: 'my_secret' }));
        expect(JSON.stringify(spy.mock.calls)).not.toContain('my_secret');
        spy.mockRestore();
    });
});

// ── Elevation payload ─────────────────────────────────────────────────────────

describe('POST /api/export/garmin — elevation payload', () => {
    it('sends non-zero totalAscent for a climbing route', async () => {
        const route = [[-104.70, 39.02, 100], [-104.71, 39.03, 110], [-104.72, 39.04, 120]];
        const { payload } = await callAndCapture(route);
        expect(payload.totalAscent).toBe(20);
    });

    it('sends non-zero totalDescent for a descending route', async () => {
        const route = [[-104.70, 39.02, 120], [-104.71, 39.03, 110], [-104.72, 39.04, 100]];
        const { payload } = await callAndCapture(route);
        expect(payload.totalDescent).toBe(20);
    });

    it('correctly splits ascent and descent on a mixed route', async () => {
        // +20m up, -15m down
        const route = [[-104.70, 39.02, 100], [-104.71, 39.03, 120], [-104.72, 39.04, 105]];
        const { payload } = await callAndCapture(route);
        expect(payload.totalAscent).toBe(20);
        expect(payload.totalDescent).toBe(15);
    });

    it('sends totalAscent=0 and totalDescent=0 when route has no elevation', async () => {
        const route = [[-104.70, 39.02], [-104.71, 39.03], [-104.72, 39.04]];
        const { payload } = await callAndCapture(route);
        expect(payload.totalAscent).toBe(0);
        expect(payload.totalDescent).toBe(0);
    });

    it('elevation values in geoPoints match route coordinate elevation', async () => {
        const route = [[-104.70, 39.02, 280], [-104.71, 39.03, 285], [-104.72, 39.04, 290]];
        const { payload } = await callAndCapture(route);
        expect(payload.geoPoints[0].elevation).toBe(280);
        expect(payload.geoPoints[1].elevation).toBe(285);
        expect(payload.geoPoints[2].elevation).toBe(290);
    });

    it('elevation is in meters — 280m route point is not sent as feet (~918)', async () => {
        const route = [[-104.70, 39.02, 280], [-104.71, 39.03, 285]];
        const { payload } = await callAndCapture(route);
        payload.geoPoints.forEach((pt: any) => {
            expect(pt.elevation).toBeLessThan(600);
        });
    });

    it('geoPoints elevation defaults to 0 when route point has no elevation', async () => {
        const route = [[-104.70, 39.02], [-104.71, 39.03]];
        const { payload } = await callAndCapture(route);
        payload.geoPoints.forEach((pt: any) => {
            expect(pt.elevation).toBe(0);
        });
    });
});

// ── Course payload structure ──────────────────────────────────────────────────

describe('POST /api/export/garmin — course payload structure', () => {
    it('posts to the Garmin course-service endpoint', async () => {
        const route = [[-104.70, 39.02, 100], [-104.71, 39.03, 110]];
        const { url } = await callAndCapture(route);
        expect(url).toContain('course-service/course');
    });

    it('uses the provided course name', async () => {
        const route = [[-104.70, 39.02, 100], [-104.71, 39.03, 110]];
        const { payload } = await callAndCapture(route, 'My Route');
        expect(payload.courseName).toBe('My Route');
    });

    it('falls back to default name when none provided', async () => {
        const mockPost = jest.fn().mockResolvedValue({});
        (GarminConnect as jest.Mock).mockImplementationOnce(() => ({
            login: jest.fn(),
            client: { post: mockPost },
        }));
        await POST(makeRequest({ route: [[-104.70, 39.02, 100], [-104.71, 39.03, 110]], email: 'a@b.com', password: 'pw' }));
        const [, payload] = mockPost.mock.calls[0];
        expect(payload.courseName).toBe('StreetSweep Route');
    });

    it('geoPoints count matches route length', async () => {
        const route = [[-104.70, 39.02, 100], [-104.71, 39.03, 110], [-104.72, 39.04, 120]];
        const { payload } = await callAndCapture(route);
        expect(payload.geoPoints).toHaveLength(3);
    });

    it('first geoPoint has distance 0', async () => {
        const route = [[-104.70, 39.02, 100], [-104.71, 39.03, 110]];
        const { payload } = await callAndCapture(route);
        expect(payload.geoPoints[0].distance).toBe(0);
    });

    it('geoPoint distance is cumulative and increasing', async () => {
        const route = [[-104.70, 39.02, 100], [-104.71, 39.03, 110], [-104.72, 39.04, 120]];
        const { payload } = await callAndCapture(route);
        const distances = payload.geoPoints.map((p: any) => p.distance);
        for (let i = 1; i < distances.length; i++) {
            expect(distances[i]).toBeGreaterThanOrEqual(distances[i - 1]);
        }
    });

    it('startPoint matches first route coordinate', async () => {
        const route = [[-104.70, 39.02, 100], [-104.71, 39.03, 110]];
        const { payload } = await callAndCapture(route);
        expect(payload.startPoint.latitude).toBe(39.02);
        expect(payload.startPoint.longitude).toBe(-104.70);
    });

    it('activityTypePk is 2 (cycling)', async () => {
        const route = [[-104.70, 39.02, 100], [-104.71, 39.03, 110]];
        const { payload } = await callAndCapture(route);
        expect(payload.activityTypePk).toBe(2);
    });
});
