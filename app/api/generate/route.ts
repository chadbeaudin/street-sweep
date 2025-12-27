import { NextResponse } from 'next/server';
import { fetchOSMData } from '@/lib/overpass';
import { StreetGraph } from '@/lib/graph';
import { fetchElevationData, calculateElevationProfile } from '@/lib/elevation';

const ts = () => `[${new Date().toTimeString().slice(0, 8)}]`;

export async function POST(request: Request) {
    try {
        const { bbox, riddenRoads, selectedPoints, manualRoute, selectionBox, routingOptions } = await request.json();

        if (!bbox || !bbox.north || !bbox.south || !bbox.east || !bbox.west) {
            return NextResponse.json({ error: 'Invalid bounding box' }, { status: 400 });
        }

        const BUFFER = 0.005; // ~500m buffer

        let minLat = bbox.south;
        let maxLat = bbox.north;
        let minLon = bbox.west;
        let maxLon = bbox.east;

        // Expand to include all selected waypoints
        if (selectedPoints && selectedPoints.length > 0) {
            selectedPoints.forEach((p: any) => {
                minLat = Math.min(minLat, p.lat);
                maxLat = Math.max(maxLat, p.lat);
                minLon = Math.min(minLon, p.lon);
                maxLon = Math.max(maxLon, p.lon);
            });
        }

        // Expand to include all manual route points
        if (manualRoute && manualRoute.length > 0) {
            manualRoute.forEach((p: [number, number]) => {
                // p[0] is lon, p[1] is lat
                minLat = Math.min(minLat, p[1]);
                maxLat = Math.max(maxLat, p[1]);
                minLon = Math.min(minLon, p[0]);
                maxLon = Math.max(maxLon, p[0]);
            });
        }

        // Expand to include selection box
        if (selectionBox) {
            minLat = Math.min(minLat, selectionBox.south);
            maxLat = Math.max(maxLat, selectionBox.north);
            minLon = Math.min(minLon, selectionBox.west);
            maxLon = Math.max(maxLon, selectionBox.east);
        }

        const bufferedBbox = {
            south: minLat - BUFFER,
            west: minLon - BUFFER,
            north: maxLat + BUFFER,
            east: maxLon + BUFFER
        };

        console.log(`${ts()} Fetching OSM data for buffered bbox:`, bufferedBbox);
        const osmData = await fetchOSMData(bufferedBbox);
        console.log(`${ts()} Fetched ${osmData.elements.length} elements.`);

        const graph = StreetGraph.getCachedGraph(bufferedBbox, osmData, riddenRoads, routingOptions);

        console.log(`${ts()} Solving Routing Problem...`);
        const startPoint = selectedPoints && selectedPoints.length > 0 ? selectedPoints[0] : undefined;
        const endPoint = selectedPoints && selectedPoints.length > 0 ? selectedPoints[selectedPoints.length - 1] : undefined;
        const circuit = graph.solveCPP(startPoint, endPoint, manualRoute, selectionBox);
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
                        coordinates: sampledCoords.map((c, i) => {
                            // Find corresponding circuit point to check construction
                            const circuitPoint = circuit.find(p =>
                                Math.abs(p.lon - c[0]) < 0.00001 && Math.abs(p.lat - c[1]) < 0.00001
                            );
                            const construction = circuitPoint?.hasConstruction ? 1 : 0;
                            return [c[0], c[1], Math.round(elevations[i] * 3.28084), construction];
                        })
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
