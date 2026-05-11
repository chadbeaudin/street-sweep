export function buildGpxCourse(
    route: [number, number, number?, number?][],
    name = 'StreetSweep Course'
): string {
    return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="StreetSweep" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata>
    <name>${name}</name>
  </metadata>
  <trk>
    <name>${name}</name>
    <trkseg>
${route.map(pt => `      <trkpt lat="${pt[1]}" lon="${pt[0]}">${pt[2] !== undefined ? `\n        <ele>${pt[2]}</ele>` : ''}
      </trkpt>`).join('\n')}
    </trkseg>
  </trk>
</gpx>`;
}
