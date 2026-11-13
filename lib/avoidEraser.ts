type Coord = [number, number];

const METERS_PER_DEG_LAT = 110_540;
const METERS_PER_DEG_LON_AT_EQUATOR = 111_320;

// Removes the parts of each [lat, lon] polyline that fall inside the circle,
// splitting a polyline where the circle cuts through its middle. Returns the
// input array itself when nothing was inside, so callers can skip no-op updates.
export function eraseFromPolylines(polylines: Coord[][], center: Coord, radiusMeters: number): Coord[][] {
    const lonScale = METERS_PER_DEG_LON_AT_EQUATOR * Math.cos(center[0] * Math.PI / 180);
    const toXY = (p: Coord): [number, number] => [(p[1] - center[1]) * lonScale, (p[0] - center[0]) * METERS_PER_DEG_LAT];
    const lerp = (a: Coord, b: Coord, t: number): Coord => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

    let changed = false;
    const result: Coord[][] = [];

    for (const line of polylines) {
        if (line.length < 2) {
            const inside = line.some(p => Math.hypot(...toXY(p)) <= radiusMeters);
            if (inside) changed = true;
            else result.push(line);
            continue;
        }

        let piece: Coord[] = [];
        const flush = () => {
            if (piece.length >= 2) result.push(piece);
            piece = [];
        };

        for (let i = 0; i < line.length - 1; i++) {
            const a = line[i];
            const b = line[i + 1];
            const hit = circleInterval(toXY(a), toXY(b), radiusMeters);
            if (!hit) {
                if (piece.length === 0) piece.push(a);
                piece.push(b);
                continue;
            }
            changed = true;
            const [tIn, tOut] = hit;
            if (tIn > 0) {
                if (piece.length === 0) piece.push(a);
                piece.push(lerp(a, b, tIn));
            }
            flush();
            if (tOut < 1) piece = [lerp(a, b, tOut), b];
        }
        flush();
    }

    return changed ? result : polylines;
}

// Parameter range [tIn, tOut] within [0, 1] where segment a→b lies inside the
// origin-centered circle, or null when the segment never enters it.
function circleInterval(a: [number, number], b: [number, number], r: number): [number, number] | null {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const qa = dx * dx + dy * dy;
    const qb = 2 * (a[0] * dx + a[1] * dy);
    const qc = a[0] * a[0] + a[1] * a[1] - r * r;
    if (qa === 0) return qc <= 0 ? [0, 1] : null;
    const disc = qb * qb - 4 * qa * qc;
    if (disc <= 0) return null;
    const sqrtDisc = Math.sqrt(disc);
    const tIn = Math.max(0, (-qb - sqrtDisc) / (2 * qa));
    const tOut = Math.min(1, (-qb + sqrtDisc) / (2 * qa));
    return tIn < tOut ? [tIn, tOut] : null;
}
