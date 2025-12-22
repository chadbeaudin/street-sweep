import { fetchElevationData, calculateElevationProfile } from './elevation';

describe('elevation library robustness', () => {
    beforeEach(() => {
        global.fetch = jest.fn();
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    const mockCoords: [number, number][] = [[-105.0, 40.0], [-105.1, 40.1]];

    it('handles successful batched GET elevation fetch', async () => {
        (global.fetch as jest.Mock).mockResolvedValueOnce({
            ok: true,
            json: async () => ({ elevation: [1500, 1600] })
        });

        const elevations = await fetchElevationData(mockCoords);
        expect(elevations).toEqual([1500, 1600]);
        expect(global.fetch).toHaveBeenCalledWith(
            expect.stringContaining('latitude=40,40.1&longitude=-105,-105.1')
        );
    });

    it('throws error on elevation API failure', async () => {
        (global.fetch as jest.Mock).mockResolvedValueOnce({
            ok: false,
            status: 500,
            text: async () => 'Server Error'
        });

        await expect(fetchElevationData(mockCoords)).rejects.toThrow('Elevation API returned 500: Server Error');
    });

    it('calculates profile correctly with unit conversion', () => {
        const coords: [number, number][] = [[-105.0, 40.0], [-105.001, 40.001]];
        const elevations = [1000, 1010]; // meters
        const profile = calculateElevationProfile(coords, elevations);

        expect(profile.length).toBe(2);
        expect(profile[0].elevation).toBe(3281); // 1000 * 3.28084 rounded
        expect(profile[1].elevation).toBe(3314); // 1010 * 3.28084 rounded
        expect(profile[1].distance).toBeGreaterThan(0);
    });
});
