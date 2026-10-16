export type UnitSystem = 'imperial' | 'metric';

const KM_PER_MILE = 1.609344;
const METERS_PER_FOOT = 0.3048;
const IMPERIAL_REGIONS = new Set(['US', 'LR', 'MM']);

// Route and stats data is computed in miles/feet; convert only for display.
export function distanceFromMiles(miles: number, units: UnitSystem): number {
    return units === 'metric' ? miles * KM_PER_MILE : miles;
}

export function distanceFromMeters(meters: number, units: UnitSystem): number {
    return units === 'metric' ? meters / 1000 : meters / (KM_PER_MILE * 1000);
}

export function elevationFromFeet(feet: number, units: UnitSystem): number {
    return units === 'metric' ? feet * METERS_PER_FOOT : feet;
}

export function distanceUnit(units: UnitSystem, long = false): string {
    if (units === 'metric') return 'km';
    return long ? 'miles' : 'mi';
}

export function elevationUnit(units: UnitSystem, long = false): string {
    if (units === 'metric') return long ? 'meters' : 'm';
    return long ? 'feet' : 'ft';
}

export function defaultUnitSystem(locale: string | undefined): UnitSystem {
    if (!locale) return 'imperial';
    let region: string | undefined;
    try { region = new Intl.Locale(locale).maximize().region; } catch { return 'imperial'; }
    return region && !IMPERIAL_REGIONS.has(region) ? 'metric' : 'imperial';
}
