export function bboxFromLatLngs(
    a: { lat: number; lng: number },
    b: { lat: number; lng: number },
): { north: number; south: number; east: number; west: number } {
    return {
        north: Math.max(a.lat, b.lat),
        south: Math.min(a.lat, b.lat),
        east: Math.max(a.lng, b.lng),
        west: Math.min(a.lng, b.lng),
    };
}
