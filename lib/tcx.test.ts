import { buildTcxCourse } from './tcx';

const sampleRoute: [number, number, number?, number?][] = [
    [-104.7, 39.02, 100],
    [-104.71, 39.03, 110],
];

describe('buildTcxCourse', () => {
    it('produces a valid TCX course with the given name', () => {
        const tcx = buildTcxCourse(sampleRoute, 'My Course');
        expect(tcx).toContain('<?xml version="1.0"');
        expect(tcx).toContain('<Name>My Course</Name>');
        expect(tcx).toContain('</TrainingCenterDatabase>');
    });

    // #28: TCX AltitudeMeters must be the elevation in meters, verbatim — not feet.
    it('emits AltitudeMeters in meters, not feet', () => {
        const tcx = buildTcxCourse(sampleRoute, 'Test');
        expect(tcx).toContain('<AltitudeMeters>100.00</AltitudeMeters>');
        expect(tcx).toContain('<AltitudeMeters>110.00</AltitudeMeters>');
        // 100 m in feet would be ~328 — must not appear
        expect(tcx).not.toContain('328');
    });

    it('includes positions and cumulative distance', () => {
        const tcx = buildTcxCourse(sampleRoute, 'Test');
        expect(tcx).toContain('<LatitudeDegrees>39.02</LatitudeDegrees>');
        expect(tcx).toContain('<LongitudeDegrees>-104.7</LongitudeDegrees>');
        expect(tcx).toMatch(/<DistanceMeters>\d+\.\d{2}<\/DistanceMeters>/);
    });

    it('defaults missing elevation to 0 meters', () => {
        const noEle: [number, number, number?, number?][] = [[-104.7, 39.02], [-104.71, 39.03]];
        const tcx = buildTcxCourse(noEle, 'Test');
        expect(tcx).toContain('<AltitudeMeters>0.00</AltitudeMeters>');
    });
});
