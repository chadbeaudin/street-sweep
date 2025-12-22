import { BoundingBox, OverpassResponse } from './types';

const OVERPASS_API_URL = 'https://overpass-api.de/api/interpreter';

export async function fetchOSMData(bbox: BoundingBox): Promise<OverpassResponse> {
    const query = `
    [out:json][timeout:25];
    (
      way["highway"](poly:"${bbox.south} ${bbox.west} ${bbox.north} ${bbox.east}"); 
      way["highway"]["highway"!~"motorway|trunk|primary|secondary|tertiary"](if:length() < 20000);
    );
    (._;>;);
    out body;
  `;

    // Efficient query for streets suitable for cycling
    // Excluding major highways if needed, but for "coverage" we usually want residential
    // Using a simpler query for getting all bike-accessible roads:

    const bikeQuery = `
    [out:json][timeout:25];
    (
      way["highway"]
         ["highway"!~"motorway|trunk|motorway_link|trunk_link"]
         ["access"!~"private|no"]
         (${bbox.south},${bbox.west},${bbox.north},${bbox.east});
    );
    (._;>;);
    out body;
  `;

    try {
        const response = await fetch(OVERPASS_API_URL, {
            method: 'POST',
            body: bikeQuery, // Overpass accepts raw query body
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            }
        });

        if (!response.ok) {
            throw new Error(`Overpass API error: ${response.status} ${response.statusText}`);
        }

        const data = (await response.json()) as OverpassResponse;
        return data;
    } catch (error) {
        console.error("Failed to fetch OSM data:", error);
        throw error;
    }
}

export async function fetchOSMDataByQuery(queryStr: string): Promise<OverpassResponse> {
    // For geocoding, we might need a geocoding service like Nominatim to get BBox first.
    // This function is a place holder.
    throw new Error("Not implemented");
}
