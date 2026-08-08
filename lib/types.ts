export interface OSMNode {
    type: 'node';
    id: number;
    lat: number;
    lon: number;
    tags?: Record<string, string>;
}

export interface OSMWay {
    type: 'way';
    id: number;
    nodes: number[];
    geometry?: { lat: number; lon: number }[];
    tags?: Record<string, string>;
}

export type OSMElement = OSMNode | OSMWay;

export interface OverpassResponse {
    version: number;
    generator: string;
    osm3s: {
        timestamp_osm_base: string;
        copyright: string;
    };
    elements: OSMElement[];
    // Set when the request was deliberately skipped for being too large to
    // safely send to the Overpass mirror — distinct from a genuine empty/failed
    // OSM response, so callers don't report it as a service outage.
    skippedTooLarge?: boolean;
}

export interface BoundingBox {
    south: number;
    west: number;
    north: number;
    east: number;
}
