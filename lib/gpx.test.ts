import { buildGpxCourse } from './gpx';

const sampleRoute: [number, number, number?, number?][] = [
    [-104.7, 39.02, 100],
    [-104.71, 39.03, 110],
];

describe('buildGpxCourse', () => {
    it('produces valid XML for a normal route name', () => {
        const gpx = buildGpxCourse(sampleRoute, 'My Route');
        expect(gpx).toContain('<name>My Route</name>');
    });

    it('escapes < and > in route name', () => {
        const gpx = buildGpxCourse(sampleRoute, 'Route <1>');
        expect(gpx).not.toContain('<name>Route <1></name>');
        expect(gpx).toContain('&lt;');
        expect(gpx).toContain('&gt;');
    });

    it('escapes & in route name', () => {
        const gpx = buildGpxCourse(sampleRoute, 'North & South');
        expect(gpx).not.toContain('North & South');
        expect(gpx).toContain('North &amp; South');
    });

    it('escapes XML injection attempt in route name', () => {
        const gpx = buildGpxCourse(sampleRoute, '</name><name>Injected');
        expect(gpx).not.toContain('<name>Injected');
        expect(gpx).toContain('&lt;/name&gt;');
    });

    it('produces well-formed XML with special characters', () => {
        const gpx = buildGpxCourse(sampleRoute, 'Route & "Test" <1>');
        // Verify the XML declaration and structure is intact
        expect(gpx).toContain('<?xml version="1.0"');
        expect(gpx).toContain('</gpx>');
        // Should not contain unescaped special chars inside element content
        const nameContent = gpx.match(/<name>(.*?)<\/name>/s)?.[1] ?? '';
        expect(nameContent).not.toContain('<');
        expect(nameContent).not.toContain('>');
        expect(nameContent).not.toMatch(/&(?!amp;|lt;|gt;|quot;|apos;)/);
    });

    it('uses default name when none provided', () => {
        const gpx = buildGpxCourse(sampleRoute);
        expect(gpx).toContain('StreetSweep Course');
    });

    it('includes route coordinates', () => {
        const gpx = buildGpxCourse(sampleRoute, 'Test');
        expect(gpx).toContain('lat="39.02"');
        expect(gpx).toContain('lon="-104.7"');
    });
});
