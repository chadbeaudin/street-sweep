import { buildChevronMarkers } from './chevrons';

// ~111320m per degree of latitude near the equator.
const M_PER_DEG_LAT = 111320;
const metersToLatDeg = (m: number) => m / M_PER_DEG_LAT;

describe('buildChevronMarkers', () => {
    it('places a chevron every ~400m along a long straight route', () => {
        const lengthM = 2000;
        const pts: [number, number][] = [[0, 0], [0, metersToLatDeg(lengthM)]];
        const markers = buildChevronMarkers(pts);
        // ~400m spacing over 2000m, starting at 200m in: expect ~5 markers (200,600,1000,1400,1800)
        expect(markers.length).toBeGreaterThanOrEqual(4);
        expect(markers.length).toBeLessThanOrEqual(6);
    });

    it('does not place two chevrons within MIN_SPATIAL_GAP_M of each other, even on a zigzagging route', () => {
        // A route that bounces back and forth across a tiny ~20m gap many times —
        // path length adds up to several multiples of the 400m chevron spacing,
        // but every point stays within a 20m physical area, simulating a
        // full-coverage route weaving through a dense grid.
        const gapDeg = metersToLatDeg(20);
        const pts: [number, number][] = [];
        for (let i = 0; i < 200; i++) {
            const lat = (i % 2 === 0) ? 0 : gapDeg;
            pts.push([0, lat]); // lon, lat order per route point convention
        }

        const markers = buildChevronMarkers(pts);
        // The bounce points are only 20m apart (well under the 120m dedup gap), so
        // every 400m-interval candidate collapses to a single surviving marker —
        // that collapse is exactly the behavior under test.
        expect(markers.length).toBe(1);

        for (let i = 0; i < markers.length; i++) {
            for (let j = i + 1; j < markers.length; j++) {
                const dLat = (markers[i].lat - markers[j].lat) * M_PER_DEG_LAT;
                const dLon = (markers[i].lon - markers[j].lon) * M_PER_DEG_LAT;
                const distM = Math.sqrt(dLat * dLat + dLon * dLon);
                expect(distM).toBeGreaterThanOrEqual(120);
            }
        }
    });

    it('returns empty for fewer than 2 points', () => {
        expect(buildChevronMarkers([])).toEqual([]);
        expect(buildChevronMarkers([[0, 0]])).toEqual([]);
    });

    it('densityScale > 1 roughly halves chevron count (zoomed-out view)', () => {
        const lengthM = 4000;
        const pts: [number, number][] = [[0, 0], [0, metersToLatDeg(lengthM)]];
        const normal = buildChevronMarkers(pts, 1);
        const zoomedOut = buildChevronMarkers(pts, 2);
        expect(zoomedOut.length).toBeLessThan(normal.length);
        expect(zoomedOut.length).toBeCloseTo(normal.length / 2, 0);
    });
});
