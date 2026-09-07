// Map-match ride GPS traces to OSM road segments and return each ridden segment
// once, following OSM geometry. Overlapping rides on a road collapse to a single
// clean line. Shared by the client map overlay and the server precompute so both
// produce identical results.
//
// `riddenRoads` and `roads` are arrays of [lat, lon] polylines.

const M_PER_DEG_LAT = 111320;
// Matches checkIfRidden's threshold in lib/graph.ts, bumped there from 25m for the
// same reason: real GPS traces corner-cut intersections (the recorded path chords
// the turn instead of hugging the actual road geometry) and drift under tree/building
// cover well past 20m. At 20m, two ridden ways meeting at a corner each lost their
// last few meters of coverage near the shared node -- visually a gap where activities
// should connect. This file and checkIfRidden answer the same "was this ridden"
// question from the same GPS data, so they should agree on how much slop counts.
const TOLERANCE_M = 50;      // how close a GPS point must be to a segment
const MIN_COVERED_M = 11;    // min traversed length for a segment to count (kills intersection spurs)
const STEP_M = 12;           // densify stride so sparse GPS points don't skip segments
const GRID = 0.005;          // ~500m spatial cells

// riddenRoads/precomputedRidden held client-side is the rider's entire ride
// history (see app/page.tsx's stravaRoadsRef), not scoped to what's on screen.
// Sending it whole in every /api/step or /api/generate request body means
// JSON.stringify -- synchronous, on the main thread -- serializes years of GPS
// points on every map click, which is what froze the tab ("Page Unresponsive")
// well before the request even reached the network. Only history within the
// request's bbox (plus enough padding to match the server's own 50m proximity
// check in lib/graph.ts's checkIfRidden) can ever affect the result, so filter
// down to that before the click handler serializes anything. Mirrors
// filterRiddenRoadsToBbox in lib/graph.ts (kept separate so this file, used by
// the client bundle, doesn't pull in graph.ts's ngraph dependency).
export function filterRiddenRoadsToBbox(
    riddenRoads: [number, number][][] | null | undefined,
    bbox: { north: number, south: number, east: number, west: number },
    paddingMeters: number = 50
): [number, number][][] | null {
    if (!riddenRoads || riddenRoads.length === 0) return riddenRoads ?? null;
    const padLat = paddingMeters / M_PER_DEG_LAT;
    const cosLat = Math.cos(((bbox.north + bbox.south) / 2) * Math.PI / 180);
    const padLon = paddingMeters / (M_PER_DEG_LAT * Math.max(cosLat, 0.01));
    const minLat = bbox.south - padLat;
    const maxLat = bbox.north + padLat;
    const minLon = bbox.west - padLon;
    const maxLon = bbox.east + padLon;
    return riddenRoads.filter(activity => activity.some(([lat, lon]) =>
        lat >= minLat && lat <= maxLat && lon >= minLon && lon <= maxLon
    ));
}

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

    // Each OSM way is matched against GPS data independently (it's its own `road`
    // entry), and ways are typically split at every intersection -- so a ridden run
    // reaching *almost* to a way's own endpoint, but not quite, leaves a visible gap
    // right where it should connect to the next street's own (independently matched)
    // run. Raising TOLERANCE_M helps GPS points that drift/corner-cut match a road at
    // all, but doesn't help a way whose covered run simply stops a bit short of its
    // terminal node for lack of any nearby GPS sample there. Snap a run to a way's own
    // start/end once it's covered up to within GAP_BRIDGE_M of it -- almost certainly
    // the same street continuing, not a genuine gap in what was ridden. The same
    // reasoning applies to a short uncovered stretch *between* two covered runs on the
    // same way (a brief GPS dropout mid-street, not two separate rides that happen to
    // stop short of each other) -- bridge those too, not just the way's outer ends.
    const GAP_BRIDGE_M = 20;

    const out: [number, number][][] = [];
    for (let r = 0; r < roads.length; r++) {
        const road = roads[r];
        const cum = [0];
        for (let s = 0; s < road.length - 1; s++) {
            const [la1, lo1] = road[s], [la2, lo2] = road[s + 1];
            const mLon = M_PER_DEG_LAT * Math.cos(la1 * Math.PI / 180);
            cum.push(cum[s] + Math.hypot((la2 - la1) * M_PER_DEG_LAT, (lo2 - lo1) * mLon));
        }
        const totalLen = cum[cum.length - 1];

        const runs: [number, number][] = []; // [startVertexIdx, endVertexIdx]
        let startIdx: number | null = null;
        for (let s = 0; s < road.length - 1; s++) {
            if (isRidden(`${r}:${s}`)) {
                if (startIdx === null) startIdx = s;
            } else if (startIdx !== null) {
                runs.push([startIdx, s]);
                startIdx = null;
            }
        }
        if (startIdx !== null) runs.push([startIdx, road.length - 1]);

        // Bridge short gaps between adjacent runs first, then snap the (now possibly
        // merged) outer runs to the way's own start/end.
        const bridged: [number, number][] = [];
        for (const run of runs) {
            const prev = bridged[bridged.length - 1];
            if (prev && cum[run[0]] - cum[prev[1]] <= GAP_BRIDGE_M) {
                prev[1] = run[1];
            } else {
                bridged.push(run);
            }
        }

        for (const run of bridged) {
            if (cum[run[0]] <= GAP_BRIDGE_M) run[0] = 0;
            if (totalLen - cum[run[1]] <= GAP_BRIDGE_M) run[1] = road.length - 1;
        }

        for (const [startVertex, endVertex] of bridged) {
            out.push(road.slice(startVertex, endVertex + 1));
        }
    }
    return out;
}

// Combines the server-precomputed, viewport-independent ridden overlay with a
// fresh viewport-local dedupe of the client's own Strava data for display.
// precomputedRidden is only refreshed on a background timer with no
// invalidation hook when new activities sync, so on its own it can hide a
// ride from a few hours ago that the client already knows about. Unioning
// both means the overlay only ever gains coverage as fresher data arrives —
// it never regresses to hide a road the user just saw rendered.
export function combineRiddenOverlay(
    precomputedRidden: [number, number][][] | null | undefined,
    freshDeduped: [number, number][][]
): [number, number][][] {
    if (precomputedRidden && precomputedRidden.length > 0) {
        return freshDeduped.length > 0 ? [...precomputedRidden, ...freshDeduped] : precomputedRidden;
    }
    return freshDeduped;
}
