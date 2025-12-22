import { NextResponse } from 'next/server';
import { fetchOSMData } from '@/lib/overpass';
import { StreetGraph } from '@/lib/graph';

export async function POST(request: Request) {
    try {
        const { bbox } = await request.json();

        if (!bbox || !bbox.north || !bbox.south || !bbox.east || !bbox.west) {
            return NextResponse.json({ error: 'Invalid bounding box' }, { status: 400 });
        }

        console.log('Fetching OSM data for bbox:', bbox);
        const osmData = await fetchOSMData(bbox);
        console.log(`Fetched ${osmData.elements.length} elements.`);

        const graph = new StreetGraph();
        graph.buildFromOSM(osmData);

        console.log('Solving CPP...');
        const circuit = graph.solveCPP();
        console.log(`Generated circuit with ${circuit.length} points.`);

        // Convert circuit to GeoJSON LineString
        const geoJson = {
            type: 'FeatureCollection',
            features: [
                {
                    type: 'Feature',
                    properties: {},
                    geometry: {
                        type: 'LineString',
                        coordinates: circuit.map(p => [p.lon, p.lat])
                    }
                }
            ]
        };

        return NextResponse.json(geoJson);
    } catch (error) {
        console.error('Error in generate route:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
