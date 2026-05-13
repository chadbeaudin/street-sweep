/**
 * Calculates the distance between two points on Earth using the Haversine formula.
 * @param lat1 Latitude of the first point in decimal degrees
 * @param lon1 Longitude of the first point in decimal degrees
 * @param lat2 Latitude of the second point in decimal degrees
 * @param lon2 Longitude of the second point in decimal degrees
 * @returns Distance in meters
 */
export function haversineM(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371000; // Radius of the Earth in meters
    const toR = (d: number) => d * Math.PI / 180;
    const dLat = toR(lat2 - lat1);
    const dLon = toR(lon2 - lon1);
    const a = Math.sin(dLat / 2) ** 2 + 
              Math.cos(toR(lat1)) * Math.cos(toR(lat2)) * 
              Math.sin(dLon / 2) ** 2;
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

/**
 * Converts decimal degrees to semicircles (Garmin internal format).
 * @param deg Decimal degrees
 * @returns Semicircles as an integer
 */
export function toSemicircles(deg: number): number {
    return Math.round(deg * (Math.pow(2, 31) / 180));
}
