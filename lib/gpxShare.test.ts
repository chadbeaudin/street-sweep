/** @jest-environment jsdom */
import { buildGpxFile } from './gpxShare';

test('buildGpxFile wraps GPX text as a named .gpx File', () => {
    const f = buildGpxFile('<gpx></gpx>', 'route.gpx');
    expect(f.name).toBe('route.gpx');
    expect(f.type).toBe('application/gpx+xml');
});
