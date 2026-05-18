// Tests for issue #16: Garmin password must not be logged or stored.

const mockJson = jest.fn((data: any, init?: { status?: number }) => ({
    status: init?.status ?? 200,
    _data: data,
}));

jest.mock('next/server', () => ({ NextResponse: { json: mockJson } }));
jest.mock('garmin-connect', () => ({
    GarminConnect: jest.fn().mockImplementation(() => ({
        login: jest.fn(),
        client: { post: jest.fn() },
    })),
}));
jest.mock('@/lib/geometry', () => ({ haversineM: jest.fn(() => 100) }));

import { POST } from './route';
import { GarminConnect } from 'garmin-connect';

const sampleRoute = [[-104.7, 39.02, 100], [-104.71, 39.03, 110]];

function makeRequest(body: any): Request {
    return new Request('http://localhost/api/export/garmin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
}

describe('POST /api/export/garmin', () => {
    it('returns 400 when password is missing', async () => {
        await POST(makeRequest({ route: sampleRoute, email: 'test@example.com' }));
        const [, init] = mockJson.mock.calls[0];
        expect(init?.status).toBe(400);
    });

    it('returns 400 when email is missing', async () => {
        await POST(makeRequest({ route: sampleRoute, password: 'secret' }));
        const [, init] = mockJson.mock.calls[0];
        expect(init?.status).toBe(400);
    });

    it('does not include password in error response', async () => {
        const mockLogin = jest.fn().mockRejectedValueOnce(new Error('Invalid credentials'));
        (GarminConnect as jest.Mock).mockImplementationOnce(() => ({ login: mockLogin, client: { post: jest.fn() } }));

        await POST(makeRequest({ route: sampleRoute, email: 'test@example.com', password: 'my_secret_password' }));
        const [data] = mockJson.mock.calls[0];
        expect(JSON.stringify(data)).not.toContain('my_secret_password');
    });

    it('logs only error message, not full error object', async () => {
        const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
        const err = new Error('Auth failed');
        (err as any).config = { data: 'password=my_secret_password' };

        const mockLogin = jest.fn().mockRejectedValueOnce(err);
        (GarminConnect as jest.Mock).mockImplementationOnce(() => ({ login: mockLogin, client: { post: jest.fn() } }));

        await POST(makeRequest({ route: sampleRoute, email: 'test@example.com', password: 'my_secret_password' }));

        const loggedArgs = consoleSpy.mock.calls[0];
        expect(loggedArgs[1]).toBe('Auth failed');
        expect(JSON.stringify(loggedArgs)).not.toContain('my_secret_password');
        consoleSpy.mockRestore();
    });
});
