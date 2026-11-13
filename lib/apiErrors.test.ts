const mockJson = jest.fn((data: unknown, init?: { status?: number }) => ({ status: init?.status, _data: data }));
jest.mock('next/server', () => ({ NextResponse: { json: mockJson } }));

import { errorResponse, UserFacingError } from './apiErrors';

let logged: jest.SpyInstance;
beforeEach(() => { logged = jest.spyOn(console, 'error').mockImplementation(() => {}); });
afterEach(() => logged.mockRestore());

describe('errorResponse (#196)', () => {
    it('answers with the fixed message and logs the real error', () => {
        const upstream = new Error('Overpass API error: 504. <html>gateway</html>');
        errorResponse(upstream, 'Roads failed:', "Couldn't load map roads.");
        expect(mockJson).toHaveBeenLastCalledWith({ error: "Couldn't load map roads." }, { status: 500 });
        expect(logged).toHaveBeenCalledWith('Roads failed:', upstream);
    });

    it('passes through a message written for the user', () => {
        errorResponse(new UserFacingError('Reconnect and try again.'), 'Library failed:', 'Generic.');
        expect(mockJson).toHaveBeenLastCalledWith({ error: 'Reconnect and try again.' }, { status: 500 });
    });

    it('uses the given status and extra fields', () => {
        errorResponse('not even an Error', 'Generate failed:', 'Map data unavailable.', 503, { degraded: true });
        expect(mockJson).toHaveBeenLastCalledWith({ error: 'Map data unavailable.', degraded: true }, { status: 503 });
    });
});
