export interface ChevronMarker {
    lat: number;
    lon: number;
    angle: number;
}

// Places directional chevrons every ~SPACING_M along the route, spatially
// de-duplicated: a full-coverage route zigzags back through the same small
// area many times, so "400m along the path" can land only a few meters from
// an earlier chevron in map space. Skip a candidate that's too close to one
// already placed so density reflects the physical area, not how many times
// the route happened to pass through it.
// densityScale multiplies both the along-path spacing and the spatial dedup
// gap — pass > 1 to thin chevrons out further when zoomed out (a fixed ground
// spacing looks denser and denser as more of it fits on screen), and 1 at the
// zoom level the base spacing was tuned for.
export function buildChevronMarkers(pts: [number, number][], densityScale = 1): ChevronMarker[] {
    if (pts.length < 2) return [];
    const SPACING_M = 400 * densityScale;
    const MIN_SPATIAL_GAP_M = 120 * densityScale;
    const markers: ChevronMarker[] = [];
    const toRad = (d: number) => d * Math.PI / 180;
    const toDeg = (r: number) => r * 180 / Math.PI;
    const haversineM = (lat1: number, lon1: number, lat2: number, lon2: number) => {
        const R = 6371000;
        const dLat = toRad(lat2 - lat1); const dLon = toRad(lon2 - lon1);
        const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
        return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    };
    const bearing = (lat1: number, lon1: number, lat2: number, lon2: number) => {
        const dLon = toRad(lon2 - lon1);
        const y = Math.sin(dLon) * Math.cos(toRad(lat2));
        const x = Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) - Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(dLon);
        return (toDeg(Math.atan2(y, x)) + 360) % 360;
    };

    const cellSizeDeg = MIN_SPATIAL_GAP_M / 111320;
    const cellKey = (lat: number, lon: number) => `${Math.floor(lat / cellSizeDeg)},${Math.floor(lon / cellSizeDeg)}`;
    const placedByCell = new Map<string, { lat: number; lon: number }[]>();
    const tooCloseToExisting = (lat: number, lon: number) => {
        const cLat = Math.floor(lat / cellSizeDeg), cLon = Math.floor(lon / cellSizeDeg);
        for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
                const neighbors = placedByCell.get(`${cLat + dy},${cLon + dx}`);
                if (!neighbors) continue;
                for (const p of neighbors) {
                    if (haversineM(lat, lon, p.lat, p.lon) < MIN_SPATIAL_GAP_M) return true;
                }
            }
        }
        return false;
    };

    let distSinceLastChevron = SPACING_M / 2;
    for (let i = 1; i < pts.length; i++) {
        const [lon1, lat1] = pts[i - 1];
        const [lon2, lat2] = pts[i];
        const segLen = haversineM(lat1, lon1, lat2, lon2);
        let remaining = segLen; let traveled = 0;
        while (distSinceLastChevron + remaining >= SPACING_M) {
            const overshoot = SPACING_M - distSinceLastChevron;
            traveled += overshoot; remaining -= overshoot; distSinceLastChevron = 0;
            const frac = traveled / segLen;
            const lat = lat1 + (lat2 - lat1) * frac, lon = lon1 + (lon2 - lon1) * frac;
            if (!tooCloseToExisting(lat, lon)) {
                markers.push({ lat, lon, angle: bearing(lat1, lon1, lat2, lon2) });
                const key = cellKey(lat, lon);
                let arr = placedByCell.get(key);
                if (!arr) { arr = []; placedByCell.set(key, arr); }
                arr.push({ lat, lon });
            }
        }
        distSinceLastChevron += remaining;
    }
    return markers;
}
