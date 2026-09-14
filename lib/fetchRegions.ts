import type { BoundingBox } from './types';

// Grid cell used to rasterize the area we actually need OSM data for.
// ~1.1km at the equator, ~750m at latitude 47 — coarse enough that a long
// route decomposes into a manageable number of Overpass requests, fine
// enough that the corridor stays much smaller than the enclosing rectangle.
export const CELL_DEG = 0.01;

// How far to either side of a snapped road path we still fetch streets.
// The paths fed in here follow real roads (they come from /api/path and
// /api/step, not straight lines between clicks), so the router only needs
// enough slack around them to find reasonable parallel/connecting streets.
// Note the grid rasterization widens this further (a marked band always snaps
// out to whole CELL_DEG cells), so the corridor actually fetched is comfortably
// wider than this figure alone suggests.
export const CORRIDOR_BUFFER_DEG = 0.006; // ~660m

// Gaps bridged along a straight line (two lassos with nothing routed between
// them yet) need a wider buffer than a snapped path: a straight line is only an
// approximation of where the real connecting road runs, and a rural highway can
// bow a long way off it. Too narrow and the fetched graph comes back in
// disconnected pieces the router can't bridge at all; too wide and the corridor
// swallows the very rectangle it exists to avoid fetching. Scale with the gap —
// a short hop can't deviate much, a long one can.
export const STRAIGHT_LINE_BUFFER_MIN_DEG = 0.012; // ~1.3km
export const STRAIGHT_LINE_BUFFER_MAX_DEG = 0.03;  // ~3.3km
export const STRAIGHT_LINE_BUFFER_FRACTION = 0.15;

export function straightLineBufferFor(gapDeg: number): number {
    return Math.min(STRAIGHT_LINE_BUFFER_MAX_DEG, Math.max(STRAIGHT_LINE_BUFFER_MIN_DEG, gapDeg * STRAIGHT_LINE_BUFFER_FRACTION));
}

const cellKey = (row: number, col: number) => `${row},${col}`;

function addCell(cells: Set<string>, row: number, col: number) {
    cells.add(cellKey(row, col));
}

function markBbox(cells: Set<string>, bbox: BoundingBox, cellDeg: number) {
    const rowStart = Math.floor(bbox.south / cellDeg);
    const rowEnd = Math.floor(bbox.north / cellDeg);
    const colStart = Math.floor(bbox.west / cellDeg);
    const colEnd = Math.floor(bbox.east / cellDeg);
    for (let r = rowStart; r <= rowEnd; r++) {
        for (let c = colStart; c <= colEnd; c++) addCell(cells, r, c);
    }
}

// Walk a polyline and mark every cell within `bufferDeg` of it. Segments are
// sampled at half-cell steps so a long segment can't skip over cells between
// its endpoints.
function markPath(cells: Set<string>, path: [number, number][], bufferDeg: number, cellDeg: number) {
    if (path.length === 0) return;
    if (path.length === 1) {
        const [lat, lon] = path[0];
        markBbox(cells, { south: lat - bufferDeg, north: lat + bufferDeg, west: lon - bufferDeg, east: lon + bufferDeg }, cellDeg);
        return;
    }
    const step = cellDeg / 2;
    for (let i = 1; i < path.length; i++) {
        const [lat1, lon1] = path[i - 1];
        const [lat2, lon2] = path[i];
        const dLat = lat2 - lat1;
        const dLon = lon2 - lon1;
        const segLen = Math.hypot(dLat, dLon);
        const steps = Math.max(1, Math.ceil(segLen / step));
        for (let s = 0; s <= steps; s++) {
            const t = s / steps;
            const lat = lat1 + dLat * t;
            const lon = lon1 + dLon * t;
            markBbox(cells, { south: lat - bufferDeg, north: lat + bufferDeg, west: lon - bufferDeg, east: lon + bufferDeg }, cellDeg);
        }
    }
}

// Merge marked cells into as few rectangles as possible: first collapse each
// row into horizontal runs, then merge vertically-adjacent runs that span the
// same columns. Keeps the Overpass request count low without refetching any
// area twice (the rectangles are disjoint).
function cellsToRects(cells: Set<string>, cellDeg: number): BoundingBox[] {
    const byRow = new Map<number, number[]>();
    for (const key of cells) {
        const [r, c] = key.split(',').map(Number);
        if (!byRow.has(r)) byRow.set(r, []);
        byRow.get(r)!.push(c);
    }

    type Run = { row: number; colStart: number; colEnd: number };
    const runs: Run[] = [];
    for (const [row, cols] of byRow) {
        cols.sort((a, b) => a - b);
        let start = cols[0];
        let prev = cols[0];
        for (let i = 1; i < cols.length; i++) {
            if (cols[i] === prev + 1) { prev = cols[i]; continue; }
            runs.push({ row, colStart: start, colEnd: prev });
            start = cols[i];
            prev = cols[i];
        }
        runs.push({ row, colStart: start, colEnd: prev });
    }

    // Merge runs stacked vertically with identical column spans into one rect.
    runs.sort((a, b) => a.colStart - b.colStart || a.colEnd - b.colEnd || a.row - b.row);
    const rects: BoundingBox[] = [];
    let i = 0;
    while (i < runs.length) {
        const { colStart, colEnd } = runs[i];
        let rowStart = runs[i].row;
        let rowEnd = runs[i].row;
        let j = i + 1;
        while (j < runs.length && runs[j].colStart === colStart && runs[j].colEnd === colEnd && runs[j].row === rowEnd + 1) {
            rowEnd = runs[j].row;
            j++;
        }
        rects.push({
            south: rowStart * cellDeg,
            north: (rowEnd + 1) * cellDeg,
            west: colStart * cellDeg,
            east: (colEnd + 1) * cellDeg,
        });
        i = j;
    }
    return rects;
}

const parseCell = (key: string): [number, number] => {
    const comma = key.indexOf(',');
    return [Number(key.slice(0, comma)), Number(key.slice(comma + 1))];
};

// Center of a grid cell, as [lat, lon].
const cellCenter = (row: number, col: number, cellDeg: number): [number, number] => [
    (row + 0.5) * cellDeg,
    (col + 0.5) * cellDeg,
];

// Group marked cells into edge-adjacent (4-connectivity) components. Two cells
// touching only at a corner are deliberately NOT treated as connected — roads
// can't be relied on to cross a bare corner, so such a pair still needs a
// corridor marked between them.
function connectedComponents(cells: Set<string>): string[][] {
    const unvisited = new Set(cells);
    const components: string[][] = [];
    while (unvisited.size > 0) {
        const start = unvisited.values().next().value as string;
        unvisited.delete(start);
        const component = [start];
        const queue = [start];
        while (queue.length > 0) {
            const [r, c] = parseCell(queue.pop()!);
            for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
                const neighbor = cellKey(r + dr, c + dc);
                if (!unvisited.has(neighbor)) continue;
                unvisited.delete(neighbor);
                component.push(neighbor);
                queue.push(neighbor);
            }
        }
        components.push(component);
    }
    return components;
}

/**
 * Make the fetched area contiguous by corridoring across any gaps.
 *
 * A user can draw two lassos far apart without ever routing between them, so
 * there's no snapped path to corridor along. Marking only the two areas would
 * fetch two islands of streets with no roads in between, and the router can't
 * bridge components it has no data for. Repeatedly connect the two closest
 * disconnected pieces with a straight corridor until everything is one piece —
 * which is exactly the connection the user would have had to draw by hand.
 */
function connectComponents(cells: Set<string>, cellDeg: number) {
    let components = connectedComponents(cells);
    // Each pass merges at least two components, so this terminates; the bound
    // is belt-and-braces against a pathological input.
    let guard = components.length + 1;
    while (components.length > 1 && guard-- > 0) {
        // Find the closest pair of cells across two different components. Big
        // components are subsampled so this stays cheap — the corridor is far
        // wider than a cell, so connecting from a near-closest cell rather than
        // the exact closest one makes no practical difference to what's fetched.
        const MAX_CELLS_PER_COMPONENT = 250;
        const sample = (component: string[]) => {
            if (component.length <= MAX_CELLS_PER_COMPONENT) return component;
            const stride = Math.ceil(component.length / MAX_CELLS_PER_COMPONENT);
            return component.filter((_, idx) => idx % stride === 0);
        };
        const sampled = components.map(sample);

        let best: { a: string; b: string; dist: number } | null = null;
        for (let i = 0; i < sampled.length; i++) {
            for (let j = i + 1; j < sampled.length; j++) {
                for (const aKey of sampled[i]) {
                    const [ar, ac] = parseCell(aKey);
                    for (const bKey of sampled[j]) {
                        const [br, bc] = parseCell(bKey);
                        const dist = Math.hypot(ar - br, ac - bc);
                        if (!best || dist < best.dist) best = { a: aKey, b: bKey, dist };
                    }
                }
            }
        }
        if (!best) break;

        const [ar, ac] = parseCell(best.a);
        const [br, bc] = parseCell(best.b);
        const from = cellCenter(ar, ac, cellDeg);
        const to = cellCenter(br, bc, cellDeg);
        markPath(cells, [from, to], straightLineBufferFor(Math.hypot(from[0] - to[0], from[1] - to[1])), cellDeg);
        components = connectedComponents(cells);
    }
}

export function bboxArea(b: BoundingBox): number {
    return Math.abs(b.north - b.south) * Math.abs(b.east - b.west);
}

export interface FetchRegionInput {
    /** Buffered bboxes of drawn selection areas (boxes and polygon bounds). */
    areaBboxes?: BoundingBox[];
    /** Snapped road paths connecting things, as [lat, lon] pairs. */
    paths?: [number, number][][];
    /** Individually clicked waypoints, as [lat, lon]. */
    points?: [number, number][];
    /**
     * Cap on how many rectangles (and therefore Overpass requests) to produce.
     * Exceeding it coarsens the grid rather than giving up — see below.
     */
    maxRegions?: number;
}

export const DEFAULT_MAX_REGIONS = 32;

/**
 * Decompose everything a route actually needs OSM data for into a small set of
 * disjoint rectangles, instead of one rectangle enclosing all of it.
 *
 * Real prod crash (2026-09-13): a route joining a lasso over Duvall, WA to a
 * second area several miles southeast made the API fetch the entire enclosing
 * rectangle — including the empty rural gap between them — producing a
 * 148,022-edge graph. The route only ever travels a narrow corridor across
 * that gap, so fetching the corridor instead keeps the graph proportional to
 * the route rather than to the square of the distance between its endpoints.
 *
 * The result is always contiguous: areas the user hasn't connected themselves
 * (two lassos drawn with nothing routed between them) get a straight corridor
 * marked across the gap, so the router receives one connected street network
 * and can find the real connecting roads itself.
 *
 * A long corridor naturally decomposes into more rectangles, and each rectangle
 * is an Overpass request. Rather than abandon the corridor and fall back to the
 * full rectangle — worst behaviour exactly where the graph is most dangerous —
 * the grid coarsens until the count fits, trading a little precision for fewer
 * requests while still skipping the bulk of the empty gap.
 */
export function buildFetchRegions(input: FetchRegionInput): BoundingBox[] {
    const maxRegions = input.maxRegions ?? DEFAULT_MAX_REGIONS;
    let cellDeg = CELL_DEG;
    let regions: BoundingBox[] = [];

    // Each doubling roughly halves the rectangle count; bail out well before
    // the cells get so large the corridor stops saving anything.
    for (let attempt = 0; attempt < 6; attempt++) {
        const cells = new Set<string>();

        for (const bbox of input.areaBboxes ?? []) markBbox(cells, bbox, cellDeg);
        for (const path of input.paths ?? []) markPath(cells, path, CORRIDOR_BUFFER_DEG, cellDeg);
        for (const [lat, lon] of input.points ?? []) {
            markBbox(cells, { south: lat - CORRIDOR_BUFFER_DEG, north: lat + CORRIDOR_BUFFER_DEG, west: lon - CORRIDOR_BUFFER_DEG, east: lon + CORRIDOR_BUFFER_DEG }, cellDeg);
        }

        connectComponents(cells, cellDeg);

        regions = cellsToRects(cells, cellDeg);
        if (regions.length <= maxRegions) break;
        cellDeg *= 2;
    }

    return regions;
}
