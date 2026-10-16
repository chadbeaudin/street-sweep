import { isRoutableHighway, bicycleTravelDirection } from './highwayFilter';

describe('isRoutableHighway', () => {
    it('allows standard road types', () => {
        expect(isRoutableHighway('residential')).toBe(true);
        expect(isRoutableHighway('primary')).toBe(true);
        expect(isRoutableHighway('cycleway')).toBe(true);
        expect(isRoutableHighway('track')).toBe(true);
    });

    it('allows dirt trails, singletrack, and bridleways unconditionally', () => {
        expect(isRoutableHighway('path')).toBe(true);
        expect(isRoutableHighway('bridleway')).toBe(true);
        expect(isRoutableHighway('path', { surface: 'dirt' })).toBe(true);
        expect(isRoutableHighway('path', { mtb_scale: '2' })).toBe(true);
    });

    it('allows plain footway (standalone park/trail paths) but excludes sidewalks and crossings', () => {
        expect(isRoutableHighway('footway')).toBe(true);
        expect(isRoutableHighway('footway', {})).toBe(true);
        expect(isRoutableHighway('footway', { surface: 'dirt' })).toBe(true);
        expect(isRoutableHighway('footway', { footway: 'sidewalk' })).toBe(false);
        expect(isRoutableHighway('footway', { footway: 'crossing' })).toBe(false);
    });

    it('excludes footway explicitly closed to bikes', () => {
        expect(isRoutableHighway('footway', { bicycle: 'no' })).toBe(false);
        expect(isRoutableHighway('footway', { bicycle: 'private' })).toBe(false);
        expect(isRoutableHighway('footway', { bicycle: 'yes' })).toBe(true);
        expect(isRoutableHighway('footway', { bicycle: 'designated' })).toBe(true);
    });

    it('excludes plain service ways by default — most are parking-lot/private access roads', () => {
        expect(isRoutableHighway('service')).toBe(false);
        expect(isRoutableHighway('service', {})).toBe(false);
        expect(isRoutableHighway('service', { surface: 'asphalt' })).toBe(false);
        expect(isRoutableHighway('service', { surface: 'paved' })).toBe(false);
    });

    it('allows service ways only with an explicit unpaved/trail-like surface (park maintenance paths)', () => {
        expect(isRoutableHighway('service', { surface: 'compacted' })).toBe(true);
        expect(isRoutableHighway('service', { surface: 'gravel' })).toBe(true);
        expect(isRoutableHighway('service', { surface: 'dirt' })).toBe(true);
    });

    it('excludes driveways, alleys, parking aisles, and drive-throughs even with a trail-like surface', () => {
        expect(isRoutableHighway('service', { service: 'alley', surface: 'compacted' })).toBe(false);
        expect(isRoutableHighway('service', { service: 'driveway', surface: 'gravel' })).toBe(false);
        expect(isRoutableHighway('service', { service: 'parking_aisle', surface: 'compacted' })).toBe(false);
        expect(isRoutableHighway('service', { service: 'emergency_access', surface: 'gravel' })).toBe(false);
        expect(isRoutableHighway('service', { service: 'drive-through', surface: 'compacted' })).toBe(false);
    });

    it('rejects unknown or missing highway types', () => {
        expect(isRoutableHighway(undefined)).toBe(false);
        expect(isRoutableHighway('steps')).toBe(false);
        expect(isRoutableHighway('pedestrian')).toBe(false);
    });
});

describe('bicycleTravelDirection (#82)', () => {
    it('treats untagged and oneway=no ways as two-way', () => {
        expect(bicycleTravelDirection(undefined)).toBe('both');
        expect(bicycleTravelDirection({ highway: 'residential' })).toBe('both');
        expect(bicycleTravelDirection({ oneway: 'no' })).toBe('both');
    });

    it('reads oneway=yes/true/1 as forward and -1/reverse as backward', () => {
        for (const v of ['yes', 'true', '1']) expect(bicycleTravelDirection({ oneway: v })).toBe('forward');
        for (const v of ['-1', 'reverse']) expect(bicycleTravelDirection({ oneway: v })).toBe('backward');
    });

    it('treats roundabouts as implicitly one-way unless tagged otherwise', () => {
        expect(bicycleTravelDirection({ junction: 'roundabout' })).toBe('forward');
        expect(bicycleTravelDirection({ junction: 'roundabout', oneway: 'no' })).toBe('both');
    });

    it('lets bicycle exemptions override the general oneway tag', () => {
        expect(bicycleTravelDirection({ oneway: 'yes', 'oneway:bicycle': 'no' })).toBe('both');
        expect(bicycleTravelDirection({ oneway: 'yes', cycleway: 'opposite_lane' })).toBe('both');
        expect(bicycleTravelDirection({ oneway: 'yes', 'cycleway:left': 'opposite_track' })).toBe('both');
        expect(bicycleTravelDirection({ oneway: 'no', 'oneway:bicycle': 'yes' })).toBe('forward');
    });
});
