type LatLon = { lat: number; lon: number };

// The saved Start Address becomes the route's first point only when the route
// is brand new: no points yet and no area drawn (an area route already starts
// there via the generate request's startPoint).
export function homeToPrepend(enabled: boolean, home: LatLon | null, pointCount: number, hasArea: boolean): LatLon | null {
    if (!enabled || !home || pointCount > 0 || hasArea) return null;
    return { lat: home.lat, lon: home.lon };
}

// A start point picked on the map is saved under its coordinates until its
// street address has been looked up.
export function isCoordinateLabel(label: string): boolean {
    return /^-?\d+(\.\d+)?, -?\d+(\.\d+)?$/.test(label.trim());
}
