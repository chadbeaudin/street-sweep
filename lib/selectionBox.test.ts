import { bboxFromLatLngs } from './selectionBox';

test('normalizes corners regardless of drag direction', () => {
    const a = { lat: 40.1, lng: -105.3 };
    const b = { lat: 40.0, lng: -105.2 };
    expect(bboxFromLatLngs(a, b)).toEqual({ north: 40.1, south: 40.0, east: -105.2, west: -105.3 });
    // reversed drag yields the same box
    expect(bboxFromLatLngs(b, a)).toEqual({ north: 40.1, south: 40.0, east: -105.2, west: -105.3 });
});
