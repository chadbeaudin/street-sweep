import { homeToPrepend, isCoordinateLabel } from './startFromHome';

const home = { lat: 44.05, lon: -121.31, label: 'Home' };

describe('homeToPrepend', () => {
    it('starts a new point route from the saved address when enabled', () => {
        expect(homeToPrepend(true, home, 0, false)).toEqual({ lat: 44.05, lon: -121.31 });
    });

    it('does nothing when the option is off', () => {
        expect(homeToPrepend(false, home, 0, false)).toBeNull();
    });

    it('does nothing without a saved address', () => {
        expect(homeToPrepend(true, null, 0, false)).toBeNull();
    });

    it('only applies to the first point of a route', () => {
        expect(homeToPrepend(true, home, 1, false)).toBeNull();
    });

    it('leaves points added after an area alone', () => {
        expect(homeToPrepend(true, home, 0, true)).toBeNull();
    });
});

describe('isCoordinateLabel', () => {
    it('recognizes the coordinates saved for a map-picked point', () => {
        expect(isCoordinateLabel('44.29280, -121.25087')).toBe(true);
    });

    it('does not treat an address as coordinates', () => {
        expect(isCoordinateLabel('1234 NW Lemhi Pass Dr, Bend, Oregon')).toBe(false);
        expect(isCoordinateLabel('1234, Main Street')).toBe(false);
    });
});
