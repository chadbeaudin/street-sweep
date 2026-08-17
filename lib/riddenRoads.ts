// Map-match ride GPS traces to OSM road segments and return each ridden segment
// once, following OSM geometry. Overlapping rides on a road collapse to a single
// clean line. Shared by the client map overlay and the server precompute so both
// produce identical results.
//
// `riddenRoads` and `roads` are arrays of [lat, lon] polylines.

const M_PER_DEG_LAT = 111320;
const TOLERANCE_M = 20;      // how close a GPS point must be to a segment
const MIN_COVERED_M = 11;    // min traversed length for a segment to count (kills intersection spurs)
const STEP_M = 12;           // densify stride so sparse GPS points don't skip segments
const GRID = 0.005;          // ~500m spatial cells

export function dedupeRiddenRoads(
    riddenRoads: [number, number][][],
    roads: [number, number][][]
): [number, number][][] {
    if (!riddenRoads.length || !roads.length) return [];

    const cellKey = (lat: number, lon: number) => `${Math.floor(lat / GRID)},${Math.floor(lon / GRID)}`;

    // Index every OSM segment by the cells its endpoints/midpoint fall in.
    const segGrid = new Map<string, [number, number][]>();
    for (let r = 0; r < roads.length; r++) {
        const road = roads[r];
        for (let s = 0; s < road.length - 1; s++) {
            const a = road[s], b = road[s + 1];
            const pts: [number, number][] = [a, b, [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]];
            for (const [la, lo] of pts) {
                const k = cellKey(la, lo);
                let arr = segGrid.get(k);
                if (!arr) { arr = []; segGrid.set(k, arr); }
                arr.push([r, s]);
            }
        }
    }

    const ptSegProj = (pLat: number, pLon: number, aLat: number, aLon: number, bLat: number, bLon: number, mLon: number) => {
        const px = (pLon - aLon) * mLon, py = (pLat - aLat) * M_PER_DEG_LAT;
        const bx = (bLon - aLon) * mLon, by = (bLat - aLat) * M_PER_DEG_LAT;
        const len2 = bx * bx + by * by;
        let t = len2 > 0 ? (px * bx + py * by) / len2 : 0;
        t = Math.max(0, Math.min(1, t));
        const dx = px - t * bx, dy = py - t * by;
        return { dist: Math.sqrt(dx * dx + dy * dy), t, lenM: Math.sqrt(len2) };
    };

    const coverage = new Map<string, { minT: number; maxT: number; lenM: number }>();
    const markPoint = (gLat: number, gLon: number) => {
        const cand = segGrid.get(cellKey(gLat, gLon));
        if (!cand) return;
        const mLon = M_PER_DEG_LAT * Math.cos(gLat * Math.PI / 180);
        for (const [r, s] of cand) {
            const key = `${r}:${s}`;
            const existing = coverage.get(key);
            if (existing && (existing.maxT - existing.minT) * existing.lenM >= MIN_COVERED_M) continue;
            const road = roads[r];
            const { dist, t, lenM } = ptSegProj(gLat, gLon, road[s][0], road[s][1], road[s + 1][0], road[s + 1][1], mLon);
            if (dist > TOLERANCE_M) continue;
            if (!existing) coverage.set(key, { minT: t, maxT: t, lenM });
            else { if (t < existing.minT) existing.minT = t; if (t > existing.maxT) existing.maxT = t; }
        }
    };

    for (const activity of riddenRoads) {
        for (let i = 0; i < activity.length; i++) {
            const [la1, lo1] = activity[i];
            markPoint(la1, lo1);
            if (i + 1 < activity.length) {
                const [la2, lo2] = activity[i + 1];
                const mLon = M_PER_DEG_LAT * Math.cos(la1 * Math.PI / 180);
                const dM = Math.hypot((la2 - la1) * M_PER_DEG_LAT, (lo2 - lo1) * mLon);
                const steps = Math.floor(dM / STEP_M);
                for (let k = 1; k < steps; k++) {
                    const t = k / steps;
                    markPoint(la1 + (la2 - la1) * t, lo1 + (lo2 - lo1) * t);
                }
            }
        }
    }

    const isRidden = (key: string): boolean => {
        const c = coverage.get(key);
        if (!c) return false;
        const span = c.maxT - c.minT;
        return span * c.lenM >= MIN_COVERED_M || span >= 0.6;
    };

    const out: [number, number][][] = [];
    for (let r = 0; r < roads.length; r++) {
        const road = roads[r];
        let run: [number, number][] | null = null;
        for (let s = 0; s < road.length - 1; s++) {
            if (isRidden(`${r}:${s}`)) {
                if (!run) run = [road[s]];
                run.push(road[s + 1]);
            } else if (run) {
                out.push(run);
                run = null;
            }
        }
        if (run) out.push(run);
    }
    return out;
}
