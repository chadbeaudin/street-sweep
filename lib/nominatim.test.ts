jest.mock('./prisma', () => ({ prisma: {} }));

import { reverseAddress } from './nominatim';

const fetchMock = jest.fn();

beforeEach(() => {
    global.fetch = fetchMock as unknown as typeof fetch;
});

describe('reverseAddress', () => {
    it('returns the street-level address for a point', async () => {
        fetchMock.mockResolvedValue({ ok: true, json: async () => ({ display_name: '123 Main St, Bend, Oregon' }) });

        expect(await reverseAddress(44.05, -121.31)).toBe('123 Main St, Bend, Oregon');
        expect(fetchMock.mock.calls[0][0]).toContain('/reverse?lat=44.05&lon=-121.31&format=json&zoom=18');
    });

    it('returns null when no address is found', async () => {
        fetchMock.mockResolvedValue({ ok: false, status: 404 });
        expect(await reverseAddress(0, 0)).toBeNull();
    });
});
