export type GpxCoord = [number, number] | [number, number, number]; // [lon, lat] | [lon, lat, ele]

// Shared by the file-upload import route and RWGPS route loading (RWGPS
// serves any route as GPX via GET /routes/{id}.gpx) — one parser either way.
export function parseGpxTrack(text: string): GpxCoord[] {
    const coords: GpxCoord[] = [];
    const trkptRe = /<trkpt\b[^>]*\blat="([^"]+)"[^>]*\blon="([^"]+)"[^>]*>([\s\S]*?)<\/trkpt>/g;
    let m: RegExpExecArray | null;
    while ((m = trkptRe.exec(text)) !== null) {
        const lat = parseFloat(m[1]);
        const lon = parseFloat(m[2]);
        const eleMatch = /<ele>([^<]+)<\/ele>/.exec(m[3]);
        coords.push(eleMatch ? [lon, lat, parseFloat(eleMatch[1])] : [lon, lat]);
    }
    if (coords.length === 0) {
        const rteptRe = /<rtept\b[^>]*\blat="([^"]+)"[^>]*\blon="([^"]+)"[^>]*>([\s\S]*?)<\/rtept>/g;
        while ((m = rteptRe.exec(text)) !== null) {
            const lat = parseFloat(m[1]);
            const lon = parseFloat(m[2]);
            const eleMatch = /<ele>([^<]+)<\/ele>/.exec(m[3]);
            coords.push(eleMatch ? [lon, lat, parseFloat(eleMatch[1])] : [lon, lat]);
        }
    }
    return coords;
}

function escapeXml(str: string): string {
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

export function buildGpxCourse(
    route: [number, number, number?, number?][],
    name = 'StreetSweep Course'
): string {
    const safeName = escapeXml(name);
    return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="StreetSweep" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata>
    <name>${safeName}</name>
  </metadata>
  <trk>
    <name>${safeName}</name>
    <trkseg>
${route.map(pt => `      <trkpt lat="${pt[1]}" lon="${pt[0]}">${pt[2] !== undefined ? `\n        <ele>${pt[2]}</ele>` : ''}
      </trkpt>`).join('\n')}
    </trkseg>
  </trk>
</gpx>`;
}
