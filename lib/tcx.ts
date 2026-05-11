/**
 * Generates a TCX (Training Center XML) Course file string.
 * This format is specifically designed for Courses rather than Activities.
 */
export function buildTcxCourse(
    route: [number, number, number?, number?][],
    name = 'StreetSweep Course'
): string {
    const startTime = new Date().toISOString();
    
    // Calculate total distance
    let totalDist = 0;
    const points = route.map((pt, i) => {
        if (i > 0) {
            const p1 = route[i-1];
            const dist = haversineM(p1[1], p1[0], pt[1], pt[0]);
            totalDist += dist;
        }
        return {
            lat: pt[1],
            lon: pt[0],
            ele: pt[2] || 0,
            dist: totalDist,
            time: new Date(Date.now() + i * 1000).toISOString()
        };
    });

    return `<?xml version="1.0" encoding="UTF-8"?>
<TrainingCenterDatabase xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2">
  <Courses>
    <Course>
      <Name>${escapeXml(name)}</Name>
      <Lap>
        <TotalTimeSeconds>${points.length}</TotalTimeSeconds>
        <DistanceMeters>${totalDist.toFixed(2)}</DistanceMeters>
        <BeginPosition>
          <LatitudeDegrees>${points[0].lat}</LatitudeDegrees>
          <LongitudeDegrees>${points[0].lon}</LongitudeDegrees>
        </BeginPosition>
        <EndPosition>
          <LatitudeDegrees>${points[points.length-1].lat}</LatitudeDegrees>
          <LongitudeDegrees>${points[points.length-1].lon}</LongitudeDegrees>
        </EndPosition>
        <Intensity>Active</Intensity>
      </Lap>
      <Track>
        ${points.map(p => `
        <Trackpoint>
          <Time>${p.time}</Time>
          <Position>
            <LatitudeDegrees>${p.lat}</LatitudeDegrees>
            <LongitudeDegrees>${p.lon}</LongitudeDegrees>
          </Position>
          <AltitudeMeters>${p.ele.toFixed(2)}</AltitudeMeters>
          <DistanceMeters>${p.dist.toFixed(2)}</DistanceMeters>
        </Trackpoint>`).join('')}
      </Track>
    </Course>
  </Courses>
</TrainingCenterDatabase>`;
}

function escapeXml(unsafe: string): string {
    return unsafe.replace(/[<>&"']/g, (c) => {
        switch (c) {
            case '<': return '&lt;';
            case '>': return '&gt;';
            case '&': return '&amp;';
            case '"': return '&quot;';
            case "'": return '&apos;';
            default: return c;
        }
    });
}

function haversineM(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371000;
    const toR = (d: number) => d * Math.PI / 180;
    const dLat = toR(lat2 - lat1), dLon = toR(lon2 - lon1);
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(toR(lat1)) * Math.cos(toR(lat2)) * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
