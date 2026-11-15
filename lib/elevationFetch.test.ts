import { elevationSampleCount } from './elevationFetch';
import { calculateElevationGainLoss } from './elevation';

describe('elevationSampleCount (#222)', () => {
    it('asks for about 100 points per mile', () => {
        expect(elevationSampleCount(5, 10_000)).toBe(500);
        expect(elevationSampleCount(12, 10_000)).toBe(1200);
    });

    it('keeps a floor of 50 points and a cap of 2000', () => {
        expect(elevationSampleCount(0.2, 10_000)).toBe(50);
        expect(elevationSampleCount(100, 10_000)).toBe(2000);
    });

    it('never asks for more points than the route has', () => {
        expect(elevationSampleCount(5, 120)).toBe(120);
    });

    it('reports about the same climbing at 100 points per mile as the old 200 points per mile', () => {
        // Terrain with one value per ~295 ft cell, read by linear interpolation like the real dataset.
        const cellMiles = 0.056;
        const miles = 5;
        const cells = Array.from({ length: Math.ceil(miles / cellMiles) + 2 }, (_, i) =>
            1500 + 200 * Math.sin(i / 9) + 40 * Math.sin(i * 1.3) + 25 * Math.sin(i * 3.1));
        const sample = (perMile: number) => Array.from({ length: Math.round(miles * perMile) }, (_, k) => {
            const at = (k / (Math.round(miles * perMile) - 1)) * miles / cellMiles;
            const i = Math.floor(at);
            return cells[i] + (cells[i + 1] - cells[i]) * (at - i);
        });
        const oldGain = calculateElevationGainLoss(sample(200), 15).gain;
        const newGain = calculateElevationGainLoss(sample(100), 15).gain;
        expect(oldGain).toBeGreaterThan(500);
        expect(Math.abs(newGain - oldGain) / oldGain).toBeLessThan(0.03);
    });
});
