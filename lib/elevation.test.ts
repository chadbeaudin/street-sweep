import { fetchElevationData, calculateElevationProfile, calculateElevationGainLoss } from './elevation';

describe('calculateElevationGainLoss', () => {
    it('ignores noise below the threshold', () => {
        // Every step is +/-1, which is smaller than a 3-unit threshold — a flat route.
        // The trailing unconfirmed excursion can leave at most `threshold` of jitter.
        const elevations = [100, 101, 100, 101, 100, 99, 100];
        const { gain, loss } = calculateElevationGainLoss(elevations, 3);
        expect(gain).toBeLessThan(3);
        expect(loss).toBeLessThan(3);
    });

    it('does not amplify gain across many noisy points on a real climb', () => {
        // 200 points climbing from 100 to 150, each with +/-1 jitter — the naive
        // per-point-delta sum would wildly overstate this; hysteresis should stay
        // close to the true net climb.
        const elevations: number[] = [];
        for (let i = 0; i <= 200; i++) {
            const trend = 100 + (50 * i) / 200;
            elevations.push(trend + (i % 2 === 0 ? 1 : -1));
        }
        const { gain } = calculateElevationGainLoss(elevations, 10);
        expect(gain).toBeLessThan(70); // naive summation of this jitter alone exceeds 200
        expect(gain).toBeGreaterThan(30);
    });

    it('anchors a confirmed reversal at the true peak, not the confirmation point', () => {
        // 280 -> 290 (climb) -> 278 (descend past the confirmation point)
        expect(calculateElevationGainLoss([280, 285, 290, 283, 278], 3)).toEqual({ gain: 10, loss: 12 });
    });

    it('counts a real climb still in progress at the end of the route', () => {
        expect(calculateElevationGainLoss([100, 110, 120], 3)).toEqual({ gain: 20, loss: 0 });
    });

    it('returns zero for fewer than two points', () => {
        expect(calculateElevationGainLoss([], 3)).toEqual({ gain: 0, loss: 0 });
        expect(calculateElevationGainLoss([100], 3)).toEqual({ gain: 0, loss: 0 });
    });
});

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
            expect.stringContaining('ned10m')
        );
    });

    it('falls back to SRTM 30m when NED10m coverage is missing, then Open-Meteo if that also fails', async () => {
        // First call (NED10m) returns null elevations — out of US coverage
        (global.fetch as jest.Mock).mockResolvedValueOnce({
            ok: true,
            json: async () => ({ results: [{ elevation: null }, { elevation: null }] })
        });
        // Second call (SRTM 30m) fails
        (global.fetch as jest.Mock).mockResolvedValueOnce({
            ok: false,
            status: 500,
            text: async () => 'Open Topo Data Down'
        });
        // Third call (Open-Meteo) succeeds
        (global.fetch as jest.Mock).mockResolvedValueOnce({
            ok: true,
            json: async () => ({ elevation: [1510, 1610] })
        });

        const result = await fetchElevationData(mockCoords);
        expect(result.elevations).toEqual([1510, 1610]);
        expect(global.fetch).toHaveBeenCalledTimes(3);
        expect((global.fetch as jest.Mock).mock.calls[0][0]).toContain('ned10m');
        expect((global.fetch as jest.Mock).mock.calls[1][0]).toContain('srtm30m');
        expect((global.fetch as jest.Mock).mock.calls[2][0]).toContain('api.open-meteo.com');
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
