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

// Mirrors checkProximity's bearing gate in lib/graph.ts: proximity alone let a GPS
// point on a main road match a short dead-end spur or cross-street segment that
// happened to sit within TOLERANCE_M, even though the rider's actual travel
// direction there ran along the main road, not the spur -- rendering a short
// perpendicular "ridden" tick that was never actually ridden. Close matches skip
// the check (turns/doglegs near intersections legitimately have odd local
// bearings); only the borderline outer band, where a perpendicular street is most
// likely to falsely qualify, gets filtered.
const BEARING_CHECK_DISTANCE_M = 20;
const MAX_BEARING_DIFF_DEG = 85;
// Matches checkProximity's own endpoint exclusion in lib/graph.ts -- a GPS point at an
// intersection is shared by every road meeting there, so it can't prove travel down any
// one of them.
const ENDPOINT_EXCLUSION_M = 10;

function bearingDeg(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const φ1 = lat1 * Math.PI / 180, φ2 = lat2 * Math.PI / 180;
    const Δλ = (lon2 - lon1) * Math.PI / 180;
    const y = Math.sin(Δλ) * Math.cos(φ2);
    const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
    return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

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

// `bounds` is the area `roads` was fetched for: junctions outside it may be
// missing side streets, so gap filling never trusts them.
export function dedupeRiddenRoads(
    riddenRoads: [number, number][][],
    roads: [number, number][][],
    bounds?: { south: number; west: number; north: number; east: number }
): [number, number][][] {
    if (!riddenRoads.length || !roads.length) return [];

    const cellKey = (lat: number, lon: number) => `${Math.floor(lat / GRID)},${Math.floor(lon / GRID)}`;

    // Index every OSM segment into every cell within TOLERANCE_M of it. Indexing
    // only the cells its own points fell in missed GPS points just across a cell
    // line from the street (West 27th Ave in Spokane runs ~2m south of one, and
    // a ride along it matched 0m because every GPS point landed in the next cell).
    const segGrid = new Map<string, [number, number][]>();
    for (let r = 0; r < roads.length; r++) {
        const road = roads[r];
        for (let s = 0; s < road.length - 1; s++) {
            const a = road[s], b = road[s + 1];
            const padLat = TOLERANCE_M / M_PER_DEG_LAT;
            const padLon = TOLERANCE_M / (M_PER_DEG_LAT * Math.cos(a[0] * Math.PI / 180));
            const minCy = Math.floor((Math.min(a[0], b[0]) - padLat) / GRID), maxCy = Math.floor((Math.max(a[0], b[0]) + padLat) / GRID);
            const minCx = Math.floor((Math.min(a[1], b[1]) - padLon) / GRID), maxCx = Math.floor((Math.max(a[1], b[1]) + padLon) / GRID);
            for (let cy = minCy; cy <= maxCy; cy++) {
                for (let cx = minCx; cx <= maxCx; cx++) {
                    const k = `${cy},${cx}`;
                    let arr = segGrid.get(k);
                    if (!arr) { arr = []; segGrid.set(k, arr); }
                    arr.push([r, s]);
                }
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
    const markPoint = (gLat: number, gLon: number, travelBearing: number) => {
        const cand = segGrid.get(cellKey(gLat, gLon));
        if (!cand) return;
        const mLon = M_PER_DEG_LAT * Math.cos(gLat * Math.PI / 180);
        // Only candidates within TIE_MARGIN_M of the single closest one get credited,
        // not every candidate within TOLERANCE_M -- a GPS point belongs to one road, not
        // however many happen to sit within tolerance. Without this, a genuinely
        // different but roughly-parallel road or trail running near the real ridden
        // street for even part of its length (common in Moab's braided jeep-trail
        // network) got credited alongside it for that stretch, even though the rider
        // only ever traveled the real one. Bearing filtering alone can't catch this: a
        // parallel road shares the real road's own bearing by definition.
        //
        // A strict single-winner version of this (no margin) over-corrected: a long
        // physical road is typically split by OSM into many short way-segments, and at
        // their shared vertices a negligible geometric difference (curve, floating
        // point) can flip "closest" between two segments of that *same* road from one
        // GPS point to the next, starving whichever one loses of enough matched points
        // to individually clear MIN_COVERED_M -- fragmenting an otherwise fully-ridden
        // road into dashes. A small tie margin keeps near-equally-close candidates
        // (almost always the same road's own adjacent segments) all in play, while a
        // genuinely different nearby road -- tens of meters farther, not centimeters --
        // still loses outright.
        const TIE_MARGIN_M = 3;
        const candidates: { key: string; t: number; lenM: number; dist: number }[] = [];
        for (const [r, s] of cand) {
            const key = `${r}:${s}`;
            // (No early skip for an already-sufficiently-covered key here: that was a
            // performance shortcut, but it silently dropped the real road out of the
            // "closest candidate" race below once it had enough coverage, letting a
            // farther, wrong nearby road win by default on later points -- exactly how a
            // roughly-parallel trail sneaking within TOLERANCE_M got credited.)
            const road = roads[r];
            const { dist, t, lenM } = ptSegProj(gLat, gLon, road[s][0], road[s][1], road[s + 1][0], road[s + 1][1], mLon);
            if (dist > TOLERANCE_M) continue;
            // A GPS point sitting at (or very near) a shared intersection node projects
            // (clamped) onto EVERY road meeting there, including a short perpendicular
            // spur it never actually turned onto -- and that clamped distance can be
            // well under BEARING_CHECK_DISTANCE_M, letting it slip past the bearing
            // check below entirely regardless of angle. Force the bearing check for any
            // point landing near either endpoint, independent of distance, since that's
            // exactly the ambiguous "which of the roads meeting here did they actually
            // take" case. A blanket t-based exclusion (dropping these points outright,
            // as graph.ts's checkProximity does) was tried first, but it also throws out
            // a real ride's own start/end point landing at a road's own vertex -- with
            // short/sparse traces that can be the *only* point near a short edge,
            // costing it all its coverage. Gating on bearing instead of dropping the
            // point keeps that legitimate case (a real turn's bearing naturally aligns
            // with the segment taken) while still rejecting a main-road point whose
            // bearing runs along a different street entirely.
            const tEndpointBand = lenM > 0 ? Math.min(0.4, ENDPOINT_EXCLUSION_M / lenM) : 0;
            const nearEndpoint = t < tEndpointBand || t > 1 - tEndpointBand;
            if (nearEndpoint || dist >= BEARING_CHECK_DISTANCE_M) {
                const segBearing = bearingDeg(road[s][0], road[s][1], road[s + 1][0], road[s + 1][1]) % 180;
                const diff = Math.abs(travelBearing % 180 - segBearing);
                if (Math.min(diff, 180 - diff) > MAX_BEARING_DIFF_DEG) continue;
            }
            candidates.push({ key, t, lenM, dist });
        }
        if (candidates.length === 0) return;
        const minDist = Math.min(...candidates.map(c => c.dist));
        for (const { key, t, lenM, dist } of candidates) {
            if (dist > minDist + TIE_MARGIN_M) continue;
            const existing = coverage.get(key);
            if (!existing) coverage.set(key, { minT: t, maxT: t, lenM });
            else { if (t < existing.minT) existing.minT = t; if (t > existing.maxT) existing.maxT = t; }
        }
    };

    for (const activity of riddenRoads) {
        for (let i = 0; i < activity.length; i++) {
            const [la1, lo1] = activity[i];
            // Local travel bearing: out of this point where possible, else into it
            // (the trace's final point) -- used to reject a point matching a nearby
            // street it never actually turned onto.
            let travelBearing = 0;
            if (i + 1 < activity.length) {
                travelBearing = bearingDeg(la1, lo1, activity[i + 1][0], activity[i + 1][1]);
            } else if (i > 0) {
                travelBearing = bearingDeg(activity[i - 1][0], activity[i - 1][1], la1, lo1);
            }
            markPoint(la1, lo1, travelBearing);
            if (i + 1 < activity.length) {
                const [la2, lo2] = activity[i + 1];
                const mLon = M_PER_DEG_LAT * Math.cos(la1 * Math.PI / 180);
                const dM = Math.hypot((la2 - la1) * M_PER_DEG_LAT, (lo2 - lo1) * mLon);
                const steps = Math.floor(dM / STEP_M);
                for (let k = 1; k < steps; k++) {
                    const t = k / steps;
                    markPoint(la1 + (la2 - la1) * t, lo1 + (lo2 - lo1) * t, travelBearing);
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

    const riddenEdges: boolean[][] = roads.map(road => new Array(Math.max(0, road.length - 1)).fill(false));
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
            for (let s = startVertex; s < endVertex; s++) riddenEdges[r][s] = true;
        }
    }

    fillUnbranchedGaps(roads, riddenEdges, bounds);

    const out: [number, number][][] = [];
    for (let r = 0; r < roads.length; r++) {
        let start: number | null = null;
        for (let s = 0; s <= riddenEdges[r].length; s++) {
            if (s < riddenEdges[r].length && riddenEdges[r][s]) {
                if (start === null) start = s;
            } else if (start !== null) {
                out.push(roads[r].slice(start, s + 1));
                start = null;
            }
        }
    }
    return out;
}

const MAX_GAP_FILL_M = 400;
const CONTINUATION_MAX_TURN_DEG = 35;

// Sparse GPS often misses a stretch of street the rider must have ridden: if
// an unmatched stretch has no side streets to leave by, and the rider was at
// both of its ends, they rode it. "Was at" means a matched road touches that
// end. At least one end must also continue matched riding along the same line
// (not just cross it), so a grid block between two ridden parallel streets
// isn't filled merely because both of its corners were visited. Mutates
// riddenEdges.
export function fillUnbranchedGaps(
    roads: [number, number][][],
    riddenEdges: boolean[][],
    bounds?: { south: number; west: number; north: number; east: number }
): void {
    const nodeKey = (p: [number, number]) => `${p[0]},${p[1]}`;
    const inBounds = (p: [number, number]) => !bounds || (p[0] >= bounds.south && p[0] <= bounds.north && p[1] >= bounds.west && p[1] <= bounds.east);
    const edgeLen = (a: [number, number], b: [number, number]) =>
        Math.hypot((b[0] - a[0]) * M_PER_DEG_LAT, (b[1] - a[1]) * M_PER_DEG_LAT * Math.cos(a[0] * Math.PI / 180));

    // Every edge (road r, segment s) incident to each node.
    const incident = new Map<string, [number, number][]>();
    for (let r = 0; r < roads.length; r++) {
        for (let s = 0; s < roads[r].length - 1; s++) {
            for (const v of [s, s + 1]) {
                const k = nodeKey(roads[r][v]);
                let arr = incident.get(k);
                if (!arr) { arr = []; incident.set(k, arr); }
                arr.push([r, s]);
            }
        }
    }
    const otherEnd = ([r, s]: [number, number], k: string) => nodeKey(roads[r][s]) === k ? roads[r][s + 1] : roads[r][s];
    const visited = (k: string) => incident.get(k)!.some(([r, s]) => riddenEdges[r][s]);
    // Does a matched edge at node k head on in roughly the same direction the
    // gap arrives from (arriving along edge e)?
    const continues = (k: string, e: [number, number]) => {
        const node = nodeKey(roads[e[0]][e[1]]) === k ? roads[e[0]][e[1]] : roads[e[0]][e[1] + 1];
        const from = otherEnd(e, k);
        const inBearing = bearingDeg(from[0], from[1], node[0], node[1]);
        return incident.get(k)!.some(([r, s]) => {
            if (!riddenEdges[r][s]) return false;
            const to = otherEnd([r, s], k);
            const outBearing = bearingDeg(node[0], node[1], to[0], to[1]);
            const turn = Math.abs(((outBearing - inBearing) % 360 + 540) % 360 - 180);
            return turn <= CONTINUATION_MAX_TURN_DEG;
        });
    };

    const seen = new Set<string>();
    for (let r0 = 0; r0 < roads.length; r0++) {
        for (let s0 = 0; s0 < riddenEdges[r0].length; s0++) {
            if (riddenEdges[r0][s0] || seen.has(`${r0}:${s0}`)) continue;
            // Walk the chain of unmatched edges outward from this one in both
            // directions, through nodes where only this street passes.
            const chain: [number, number][] = [[r0, s0]];
            seen.add(`${r0}:${s0}`);
            let length = edgeLen(roads[r0][s0], roads[r0][s0 + 1]);
            let trusted = inBounds(roads[r0][s0]) && inBounds(roads[r0][s0 + 1]);
            const ends: { node: string; via: [number, number] }[] = [];
            for (const startNode of [nodeKey(roads[r0][s0]), nodeKey(roads[r0][s0 + 1])]) {
                let node = startNode;
                let via: [number, number] = [r0, s0];
                for (;;) {
                    const edges = incident.get(node)!;
                    if (edges.length !== 2) break;
                    const next = edges.find(([r, s]) => r !== via[0] || s !== via[1])!;
                    if (riddenEdges[next[0]][next[1]] || seen.has(`${next[0]}:${next[1]}`)) break;
                    seen.add(`${next[0]}:${next[1]}`);
                    chain.push(next);
                    length += edgeLen(roads[next[0]][next[1]], roads[next[0]][next[1] + 1]);
                    const far = otherEnd(next, node);
                    if (!inBounds(far)) trusted = false;
                    node = nodeKey(far);
                    via = next;
                }
                ends.push({ node, via });
            }
            if (!trusted || length > MAX_GAP_FILL_M) continue;
            if (ends[0].node === ends[1].node) continue; // a loop hanging off one junction -- no way to tell it was ridden
            if (!ends.every(e => visited(e.node))) continue;
            if (!ends.some(e => continues(e.node, e.via))) continue;
            for (const [r, s] of chain) riddenEdges[r][s] = true;
        }
    }
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
