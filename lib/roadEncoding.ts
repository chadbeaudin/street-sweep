import polyline from '@mapbox/polyline';

// /api/roads sends each road as an encoded polyline when asked (#181): about 7x
// smaller than [lat, lon] arrays, and 3x smaller after gzip. Precision 5 is about
// 1m, finer than OSM's own geometry and invisible at map scale; the client only
// draws with these roads and hit-tests the cursor against them.
export const ROAD_ENCODING = 'polyline5';
const PRECISION = 5;

export const encodeRoads = (roads: [number, number][][]): string[] => roads.map(r => polyline.encode(r, PRECISION));

export const decodeRoads = (encoded: string[]): [number, number][][] => encoded.map(s => polyline.decode(s, PRECISION) as [number, number][]);
