import { NextResponse } from 'next/server';
import { fetchOSMData } from '@/lib/overpass';
import { StreetGraph } from '@/lib/graph';
import { fetchElevationData, calculateElevationProfile } from '@/lib/elevation';

const ts = () => `[${new Date().toTimeString().slice(0, 8)}]`;

export async function POST(request: Request) {
    try {
        const { bbox, riddenRoads } = await request.json();

        if (!bbox || !bbox.north || !bbox.south || !bbox.east || !bbox.west) {
            return NextResponse.json({ error: 'Invalid bounding box' }, { status: 400 });
        }

        console.log(`${ts()} Fetching OSM data for bbox:`, bbox);
        const osmData = await fetchOSMData(bbox);
        console.log(`${ts()} Fetched ${osmData.elements.length} elements.`);

        const graph = new StreetGraph();
        graph.buildFromOSM(osmData, riddenRoads);

        console.log(`${ts()} Solving Routing Problem...`);
        const circuit = graph.solveCPP();
        console.log(`${ts()} Generated circuit with ${circuit.length} points.`);

        if (circuit.length === 0) {
            return NextResponse.json({ error: 'Failed to generate a valid route. The area might be disconnected or too complex.' }, { status: 500 });
        }

        const coords: [number, number][] = circuit.map(p => [p.lon, p.lat]);

        // Fetch elevation
        console.log(`${ts()} Fetching elevation data...`);
        let elevations: number[] = [];
        let sampledCoords = coords;
        try {
            const result = await fetchElevationData(coords);
            elevations = result.elevations;
            sampledCoords = result.sampledCoords;
        } catch (e) {
            console.warn(`${ts()} Elevation fetch failed, using zero elevation:`, e);
            elevations = new Array(coords.length).fill(0);
        }

        const profile = calculateElevationProfile(sampledCoords, elevations);
        const lastPoint = profile[profile.length - 1];
        const totalDistance = lastPoint ? lastPoint.distance : 0;

        // Convert sampled circuit to GeoJSON LineString
        // This ensures every coord point has exactly one elevation point
        const geoJson = {
            type: 'FeatureCollection',
            features: [
                {
                    type: 'Feature',
                    properties: {
                        totalDistance: totalDistance.toFixed(2),
                        elevationProfile: profile
                    },
                    geometry: {
                        type: 'LineString',
                        coordinates: sampledCoords.map((c, i) => [c[0], c[1], Math.round(elevations[i] * 3.28084)])
                    }
                }
            ]
        };

        return NextResponse.json(geoJson);
    } catch (error: any) {
        console.error('Error in generate route:', error);
        return NextResponse.json({
            error: error.message || 'Internal Server Error',
            trace: error.stack
        }, { status: 500 });
    }
}
