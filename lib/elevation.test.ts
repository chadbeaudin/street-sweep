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
            json: async () => ({ results: [{ elevation: 1500 }, { elevation: 1600 }] })
        });

        const result = await fetchElevationData(mockCoords);
        expect(result.elevations).toEqual([1500, 1600]);
        expect(result.sampledCoords).toEqual(mockCoords);
        expect(global.fetch).toHaveBeenCalledWith(
            expect.stringContaining('api.opentopodata.org')
        );
    });

    it('falls back to second provider on first one failure', async () => {
        // First call (Open Topo Data) fails
        (global.fetch as jest.Mock).mockResolvedValueOnce({
            ok: false,
            status: 500,
            text: async () => 'Open Topo Data Down'
        });
        // Second call (Open-Meteo) succeeds
        (global.fetch as jest.Mock).mockResolvedValueOnce({
            ok: true,
            json: async () => ({ elevation: [1510, 1610] })
        });

        const result = await fetchElevationData(mockCoords);
        expect(result.elevations).toEqual([1510, 1610]);
        expect(global.fetch).toHaveBeenCalledTimes(2);
        expect((global.fetch as jest.Mock).mock.calls[1][0]).toContain('api.open-meteo.com');
    });

    it('throws error when all providers fail', async () => {
        (global.fetch as jest.Mock).mockResolvedValue({
            ok: false,
            status: 500,
            text: async () => 'Total Failure'
        });

        await expect(fetchElevationData(mockCoords)).rejects.toThrow('All elevation providers failed');
    });

    it('samples up to 2000 points for a long route (hover granularity), not capped at 1000', async () => {
        // 20 batches with a 500ms inter-batch delay (~9.5s) exceeds jest's 5s default.
        // ~50mi route (1 deg latitude ≈ 69mi): plenty of raw points so the density
        // cap, not pointsPerMile or raw coordinate count, is what's under test.
        const longRoute: [number, number][] = [];
        for (let i = 0; i <= 3000; i++) {
            longRoute.push([-105.0, 40.0 + (i / 3000) * 0.725]);
        }

        (global.fetch as jest.Mock).mockImplementation(async (url: string) => ({
            ok: true,
            json: async () => {
                const locations = new URL(url).searchParams.get('locations')!.split('|');
                return { results: locations.map(() => ({ elevation: 1500 })) };
            }
        }));

        const result = await fetchElevationData(longRoute);
        expect(result.sampledCoords.length).toBeGreaterThan(1000);
        expect(result.sampledCoords.length).toBeLessThanOrEqual(2000);
    }, 15000);

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
