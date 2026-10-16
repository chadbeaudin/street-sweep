import { defaultUnitSystem, distanceFromMeters, distanceFromMiles, distanceUnit, elevationFromFeet, elevationUnit } from './units';

describe('unit conversion', () => {
    it('leaves imperial values as they are', () => {
        expect(distanceFromMiles(10, 'imperial')).toBe(10);
        expect(elevationFromFeet(1000, 'imperial')).toBe(1000);
    });

    it('converts miles to km and feet to meters', () => {
        expect(distanceFromMiles(10, 'metric')).toBeCloseTo(16.093, 3);
        expect(elevationFromFeet(1000, 'metric')).toBeCloseTo(304.8, 3);
    });

    it('converts meters to the display distance unit', () => {
        expect(distanceFromMeters(1609.344, 'imperial')).toBeCloseTo(1, 6);
        expect(distanceFromMeters(2500, 'metric')).toBe(2.5);
    });

    it('labels units short and long', () => {
        expect(distanceUnit('imperial')).toBe('mi');
        expect(distanceUnit('imperial', true)).toBe('miles');
        expect(distanceUnit('metric', true)).toBe('km');
        expect(elevationUnit('imperial', true)).toBe('feet');
        expect(elevationUnit('metric')).toBe('m');
        expect(elevationUnit('metric', true)).toBe('meters');
    });
});

describe('defaultUnitSystem', () => {
    it('uses imperial for the US', () => {
        expect(defaultUnitSystem('en-US')).toBe('imperial');
        expect(defaultUnitSystem('en')).toBe('imperial');
    });

    it('uses metric elsewhere', () => {
        expect(defaultUnitSystem('en-GB')).toBe('metric');
        expect(defaultUnitSystem('de-DE')).toBe('metric');
        expect(defaultUnitSystem('fr')).toBe('metric');
    });

    it('falls back to imperial for a missing or invalid locale', () => {
        expect(defaultUnitSystem(undefined)).toBe('imperial');
        expect(defaultUnitSystem('not a locale!')).toBe('imperial');
    });
});
