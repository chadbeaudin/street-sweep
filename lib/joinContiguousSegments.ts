type LatLng = [number, number];

const GAP_DEG = 0.0001; // ~10 m

// Joins drawn segments into polylines, starting a new one wherever a segment does not
// begin where the previous ended, so no straight line is drawn across the gap (#46).
export function joinContiguousSegments(segments: LatLng[][]): LatLng[][] {
    const lines: LatLng[][] = [];
    for (const segment of segments) {
        if (segment.length === 0) continue;
        const current = lines[lines.length - 1];
        const end = current?.[current.length - 1];
        const [lat, lon] = segment[0];
        if (end && Math.abs(end[0] - lat) < GAP_DEG && Math.abs(end[1] - lon) < GAP_DEG) current.push(...segment);
        else lines.push([...segment]);
    }
    return lines;
}
