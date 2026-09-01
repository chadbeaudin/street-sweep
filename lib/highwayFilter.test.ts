import { isRoutableHighway } from './highwayFilter';

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

    it('allows plain service ways (park maintenance/multi-use paths) but excludes driveways, alleys, and parking aisles', () => {
        expect(isRoutableHighway('service')).toBe(true);
        expect(isRoutableHighway('service', {})).toBe(true);
        expect(isRoutableHighway('service', { surface: 'compacted' })).toBe(true);
        expect(isRoutableHighway('service', { service: 'alley' })).toBe(false);
        expect(isRoutableHighway('service', { service: 'driveway' })).toBe(false);
        expect(isRoutableHighway('service', { service: 'parking_aisle' })).toBe(false);
        expect(isRoutableHighway('service', { service: 'emergency_access' })).toBe(false);
    });

    it('rejects unknown or missing highway types', () => {
        expect(isRoutableHighway(undefined)).toBe(false);
        expect(isRoutableHighway('steps')).toBe(false);
        expect(isRoutableHighway('pedestrian')).toBe(false);
    });
});
