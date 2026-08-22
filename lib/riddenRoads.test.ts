import { dedupeRiddenRoads, combineRiddenOverlay } from './riddenRoads';

// ~111320m per degree of latitude, used to build roads/traces at known real-world distances.
const M_PER_DEG_LAT = 111320;
const metersToLatDeg = (m: number) => m / M_PER_DEG_LAT;

describe('dedupeRiddenRoads', () => {
    it('does not mark a short intersection spur as ridden from GPS jitter while cornering, without actually turning onto it', () => {
        // Main road running north-south through (0, 0).
        const mainRoad: [number, number][] = [[-0.01, 0], [0, 0], [0.01, 0]];
        // A short spur (~20m) branching east from the intersection.
        const spurLenDeg = metersToLatDeg(20);
        const spur: [number, number][] = [[0, 0], [0, spurLenDeg]];

        // Rider travels the main road and takes the corner a little wide (GPS jitter/lean),
        // clipping ~2m into the spur's territory at roughly its 40%-length point, but never
        // actually turns onto it — the trace continues straight up the main road.
        const jitterOffsetLat = metersToLatDeg(2);
        const ride: [number, number][] = [
            [-0.005, 0],
            [0, 0],
            [jitterOffsetLat, spurLenDeg * 0.4],
            [0.005, 0],
        ];

        const result = dedupeRiddenRoads([ride], [mainRoad, spur]);
        const hitSpur = result.some(seg => seg.some(([, lon]) => lon > 0));
        expect(hitSpur).toBe(false);
    });

    it('marks a spur as ridden when the rider actually turns onto it', () => {
        const mainRoad: [number, number][] = [[-0.01, 0], [0, 0], [0.01, 0]];
        const spurLenDeg = metersToLatDeg(20);
        const spur: [number, number][] = [[0, 0], [0, spurLenDeg]];

        // Rider comes up the main road and turns onto the full spur.
        const ride: [number, number][] = [[-0.005, 0], [0, 0], [0, spurLenDeg]];

        const result = dedupeRiddenRoads([ride], [mainRoad, spur]);
        const hitSpur = result.some(seg => seg.some(([, lon]) => lon > 0));
        expect(hitSpur).toBe(true);
    });
});

describe('combineRiddenOverlay', () => {
    const precomputed: [number, number][][] = [[[0, 0], [0, 0.001]]];
    const fresh: [number, number][][] = [[[1, 1], [1, 1.001]]];

    it('unions precomputed and fresh roads when both are present — a fresh road never disappears', () => {
        const result = combineRiddenOverlay(precomputed, fresh);
        expect(result).toEqual([...precomputed, ...fresh]);
    });

    it('returns precomputed alone when there is no fresh data yet', () => {
        expect(combineRiddenOverlay(precomputed, [])).toEqual(precomputed);
    });

    it('falls back to fresh data when precomputed is not available yet', () => {
        expect(combineRiddenOverlay(null, fresh)).toEqual(fresh);
        expect(combineRiddenOverlay(undefined, fresh)).toEqual(fresh);
        expect(combineRiddenOverlay([], fresh)).toEqual(fresh);
    });

    it('returns empty when neither source has data', () => {
        expect(combineRiddenOverlay(null, [])).toEqual([]);
        expect(combineRiddenOverlay([], [])).toEqual([]);
    });
});
