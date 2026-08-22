import { NextResponse } from 'next/server';
import { fetchOSMData } from '@/lib/overpass';
import { StreetGraph } from '@/lib/graph';
import { fetchElevationData, calculateElevationProfile } from '@/lib/elevation';

const ts = () => `[${new Date().toTimeString().slice(0, 8)}]`;

export async function POST(request: Request) {
    try {
        const { bbox, riddenRoads, selectedPoints, startPoint: persistentStart, manualRoute, selectionBox, selectionBoxes: selectionBoxesRaw, selectionPolygons: selectionPolygonsRaw, routingOptions, preAreaPointCount, exitRoute, approachRoute } = await request.json();

        // Backward compatibility: Convert single selectionBox to array if present
        const selectionBoxes = selectionBoxesRaw || (selectionBox ? [selectionBox] : null);
        const selectionPolygons: [number, number][][] = selectionPolygonsRaw || [];

        console.log(`${ts()} API received: boxes=${selectionBoxes?.length || 0}, polygons=${selectionPolygons.length}`);

        // Debug: log polygon bounds
        if (selectionPolygons.length > 0) {
            for (let i = 0; i < selectionPolygons.length; i++) {
                const poly = selectionPolygons[i];
                const minLat = Math.min(...poly.map(p => p[0]));
                const maxLat = Math.max(...poly.map(p => p[0]));
                const minLon = Math.min(...poly.map(p => p[1]));
                const maxLon = Math.max(...poly.map(p => p[1]));
                console.log(`${ts()}   API Polygon ${i}: bounds=[${minLat.toFixed(4)},${minLon.toFixed(4)} to ${maxLat.toFixed(4)},${maxLon.toFixed(4)}], ${poly.length} points, first=[${poly[0][0].toFixed(4)},${poly[0][1].toFixed(4)}]`);
            }
        }

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

        // Expand to include all selection boxes
        if (selectionBoxes && selectionBoxes.length > 0) {
            selectionBoxes.forEach((box: any) => {
                minLat = Math.min(minLat, box.south);
                maxLat = Math.max(maxLat, box.north);
                minLon = Math.min(minLon, box.west);
                maxLon = Math.max(maxLon, box.east);
            });
        }

        // Expand to include all selection polygons
        if (selectionPolygons && selectionPolygons.length > 0) {
            selectionPolygons.forEach((polygon: [number, number][]) => {
                polygon.forEach(([lat, lon]) => {
                    minLat = Math.min(minLat, lat);
                    maxLat = Math.max(maxLat, lat);
                    minLon = Math.min(minLon, lon);
                    maxLon = Math.max(maxLon, lon);
                });
            });
        }

        const bufferedBbox = {
            south: minLat - BUFFER,
            west: minLon - BUFFER,
            north: maxLat + BUFFER,
            east: maxLon + BUFFER
        };

        // Pure point-to-point routing (no drawn area) fetches the ENTIRE bounding
        // rectangle between the points, not just a corridor along the route — so two
        // points a long distance apart create a bbox that can overwhelm Overpass
        // (times out on every mirror). Fail fast with a specific, accurate message
        // instead of a multi-minute mirror-timeout cascade ending in a vague one.
        // Capped at the same 0.5° bbox limit lib/overpass.ts already enforces as a
        // hard ceiling, so this doesn't reject anything that could succeed anyway.
        const hasDrawnArea = (selectionBoxes && selectionBoxes.length > 0) || (selectionPolygons && selectionPolygons.length > 0);
        if (!hasDrawnArea) {
            const latSpan = bufferedBbox.north - bufferedBbox.south;
            const lonSpan = bufferedBbox.east - bufferedBbox.west;
            const MAX_POINT_ROUTE_SPAN_DEG = 0.5; // ~55km — matches lib/overpass.ts's hard cap
            if (latSpan > MAX_POINT_ROUTE_SPAN_DEG || lonSpan > MAX_POINT_ROUTE_SPAN_DEG) {
                console.warn(`${ts()} Point-to-point span too large (${latSpan.toFixed(3)}x${lonSpan.toFixed(3)}), failing fast.`);
                return NextResponse.json({ error: 'Those points are too far apart to route directly — try breaking the route into shorter segments.' }, { status: 400 });
            }
        }

        console.log(`${ts()} Fetching OSM data for buffered bbox:`, bufferedBbox);
        let osmData;
        try {
            osmData = await fetchOSMData(bufferedBbox);
        } catch (osmError: any) {
            console.error(`${ts()} OSM fetch failed:`, osmError);
            return NextResponse.json({ error: osmError.message || 'Map data unavailable for this area. The routing servers may be temporarily overloaded — please try again in a moment.', degraded: true }, { status: 500 });
        }
        console.log(`${ts()} Fetched ${osmData.elements.length} elements.`);

        if (osmData.skippedTooLarge) {
            console.warn(`${ts()} Selected area too large for a single request:`, bufferedBbox);
            return NextResponse.json({ error: 'Selected area is too large — zoom in or draw a smaller area and try again.' }, { status: 400 });
        }

        if (osmData.elements.length === 0) {
            console.warn(`${ts()} OSM data is empty for bbox:`, bufferedBbox);
            return NextResponse.json({ error: 'Map data unavailable for this area. The routing servers may be temporarily overloaded — please try again in a moment.', degraded: true }, { status: 503 });
        }

        const graph = StreetGraph.getCachedGraph(bufferedBbox, osmData, riddenRoads, routingOptions);

        console.log(`${ts()} Solving Routing Problem...`);
        // Prefer an explicit clicked start; otherwise use the persistent start
        // point (a saved address, #30) so area/lasso routes begin at home.
        const startPoint = (selectedPoints && selectedPoints.length > 0)
            ? selectedPoints[0]
            : (persistentStart && typeof persistentStart.lat === 'number' ? persistentStart : undefined);

        // Use both rectangular boxes and polygons for routing
        const combinedSelections: Array<{ north: number; south: number; east: number; west: number }> = [...(selectionBoxes || [])];
        // combinedSelections only holds boxes — a lasso-only selection (polygons,
        // no boxes) must still count as "has an area" here, or hasPostAreaPoints
        // and the endPoint fallback below silently treat it as point-only routing.
        // That previously made endPoint default to the last REAL waypoint (the
        // point just before the lasso) whenever no post-area point existed yet,
        // sending the area's own coverage trail right back at its own entry point.
        const hasAreaSelection = combinedSelections.length > 0 || selectionPolygons.length > 0;

        // In mixed mode (manualRoute + selections), only pass endPoint when there are
        // genuine post-area waypoints. Approach-only waypoints must not trigger an exit bridge.
        const hasPostAreaPoints = hasAreaSelection
            && preAreaPointCount != null
            && selectedPoints?.length > preAreaPointCount;
        const endPoint = hasPostAreaPoints
            ? selectedPoints[selectedPoints.length - 1]
            : (hasAreaSelection ? undefined : selectedPoints?.[selectedPoints.length - 1]);
        const riddenPenalty = routingOptions?.riddenPenalty || 15; // Default to 15 if not specified
        // Bounding box elasticity (feet, from settings) lets required-edge inclusion reach
        // slightly beyond a drawn Area/Lasso box instead of stopping mid-edge at an
        // artificial boundary dead-end. 0 = previous behavior (no change).
        const boxElasticityFeet = routingOptions?.boxElasticity || 0;
        const boxElasticityMeters = boxElasticityFeet * 0.3048;
        const circuit = graph.solveCPP(startPoint, endPoint, manualRoute, combinedSelections.length > 0 ? combinedSelections : null, exitRoute, approachRoute, false, riddenPenalty, selectionPolygons.length > 0 ? selectionPolygons : null, boxElasticityMeters);
        console.log(`${ts()} Generated circuit with ${circuit.length} points.`);

        if (circuit.length === 0) {
            return NextResponse.json({ error: 'Failed to generate a valid route. The area might be disconnected or too complex.' }, { status: 500 });
        }

        const coords: [number, number][] = circuit.map(p => [p.lon, p.lat]);

        // Fetch elevation
        console.log(`${ts()} Fetching elevation data...`);
        let elevations: number[] = [];
        let sampledCoords: [number, number][] = coords;
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

        // Interpolate sampled elevations back to full-resolution coords so that
        // the rendered polyline exactly matches the CPP circuit geometry
        // (which is what the dashed manualRoute line is also drawn from).
        // Previously we used sampledCoords as the rendered geometry, which
        // dropped shape points and caused the solid line to drift from the
        // dashed line on routes long enough to trigger downsampling.
        const fullElevations: number[] = (() => {
            if (sampledCoords.length === coords.length) return elevations;
            if (sampledCoords.length < 2) {
                return new Array(coords.length).fill(elevations[0] ?? 0);
            }
            const step = (coords.length - 1) / (sampledCoords.length - 1);
            const out = new Array<number>(coords.length);
            for (let i = 0; i < coords.length; i++) {
                const sIdx = i / step;
                const lo = Math.floor(sIdx);
                const hi = Math.min(lo + 1, sampledCoords.length - 1);
                const t = sIdx - lo;
                out[i] = elevations[lo] * (1 - t) + elevations[hi] * t;
            }
            return out;
        })();

        // Convert full-resolution circuit to GeoJSON LineString
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
                        coordinates: coords.map((c, i) => {
                            // circuit and coords are 1:1 by index
                            const construction = circuit[i]?.hasConstruction ? 1 : 0;
                            return [c[0], c[1], fullElevations[i], construction];
                        })
                    }
                }
            ]
        };

        const degraded = osmData.elements.length === 0;
        return NextResponse.json({ ...geoJson, degraded });
    } catch (error: any) {
        console.error('Error in generate route:', error);
        // Not flagged degraded — this catches routing/elevation/graph failures
        // downstream of the OSM fetch, which already handles its own errors above.
        // A generic crash here isn't an OSM outage and shouldn't be reported as one.
        return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
    }
}
