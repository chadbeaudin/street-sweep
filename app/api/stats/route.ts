import { NextResponse } from 'next/server';
import { fetchOSMData } from '@/lib/overpass';
import { reverseGeocode, searchCityPolygon } from '@/lib/nominatim';
import {
    buildCoverageCells,
    cellsToMiles,
    pointInPolygon,
    polylineCentroid,
    quantizeCellKey
} from '@/lib/stats';
import { haversineM } from '@/lib/geometry';

const ts = () => `[${new Date().toTimeString().slice(0, 8)}]`;

const MAX_CITIES = 5;

interface CityStats {
    name: string;
    state: string | null;
    activityCount: number;
    riddenMiles: number;
    totalMiles: number;
    percent: number;
}

interface StatsResponse {
    totalActivities: number;
    totalUniqueMiles: number;
    cities: CityStats[];
}

function networkPolylinesFromOSM(data: { elements: any[] }): [number, number][][] {
    const nodeMap = new Map<number, { lat: number; lon: number }>();
    for (const el of data.elements) {
        if (el.type === 'node') nodeMap.set(el.id, { lat: el.lat, lon: el.lon });
    }
    const polylines: [number, number][][] = [];
    for (const el of data.elements) {
        if (el.type !== 'way' || !el.nodes) continue;
        const poly: [number, number][] = [];
        if (el.geometry) {
            for (const g of el.geometry) poly.push([g.lat, g.lon]);
        } else {
            for (const nid of el.nodes) {
                const n = nodeMap.get(nid);
                if (n) poly.push([n.lat, n.lon]);
            }
        }
        if (poly.length >= 2) polylines.push(poly);
    }
    return polylines;
}

function filterCellsByPolygon(cells: Set<string>, polygon: [number, number][]): Set<string> {
    // The cell key encodes the floor of (lat/lon)/CELL_DEG. We can reconstruct
    // a representative point by reversing the floor — only need it to test
    // polygon containment, not for distance.
    const CELL_METERS = 15;
    const DEG_PER_METER = 1 / 111320;
    const CELL_DEG = CELL_METERS * DEG_PER_METER;
    const out = new Set<string>();
    for (const key of cells) {
        const [cLat, cLon] = key.split(':').map(Number);
        const lat = (cLat + 0.5) * CELL_DEG;
        const lon = (cLon + 0.5) * CELL_DEG;
        if (pointInPolygon(lat, lon, polygon)) out.add(key);
    }
    return out;
}

export async function POST(request: Request) {
    try {
        const { riddenRoads } = await request.json() as { riddenRoads: [number, number][][] };
        if (!Array.isArray(riddenRoads)) {
            return NextResponse.json({ error: 'riddenRoads must be an array' }, { status: 400 });
        }

        console.log(`${ts()} Stats: ${riddenRoads.length} activities`);

        const totalCells = buildCoverageCells(riddenRoads);
        const totalUniqueMiles = cellsToMiles(totalCells.size);

        // Reverse-geocode each activity's centroid to detect its city. Cached
        // and rate-limited inside lib/nominatim.
        const centroidByActivity = riddenRoads.map(polylineCentroid);
        const cityByActivity: ({ city: string; state: string | null; country: string | null } | null)[] = [];
        for (let i = 0; i < centroidByActivity.length; i++) {
            const c = centroidByActivity[i];
            if (!c) { cityByActivity.push(null); continue; }
            try {
                const r = await reverseGeocode(c[0], c[1]);
                cityByActivity.push(r.city ? { city: r.city, state: r.state, country: r.country } : null);
            } catch (e) {
                console.warn(`${ts()} reverse-geocode failed:`, e);
                cityByActivity.push(null);
            }
        }

        const byCity = new Map<string, { city: string; state: string | null; country: string | null; activityIdx: number[] }>();
        for (let i = 0; i < cityByActivity.length; i++) {
            const info = cityByActivity[i];
            if (!info) continue;
            const key = `${info.city}|${info.state ?? ''}|${info.country ?? ''}`;
            let entry = byCity.get(key);
            if (!entry) { entry = { city: info.city, state: info.state, country: info.country, activityIdx: [] }; byCity.set(key, entry); }
            entry.activityIdx.push(i);
        }

        const topCities = Array.from(byCity.values())
            .sort((a, b) => b.activityIdx.length - a.activityIdx.length)
            .slice(0, MAX_CITIES);

        const cities: CityStats[] = [];
        for (const entry of topCities) {
            try {
                const cityPoly = await searchCityPolygon(entry.city, entry.state, entry.country);
                if (!cityPoly) {
                    cities.push({
                        name: entry.city,
                        state: entry.state,
                        activityCount: entry.activityIdx.length,
                        riddenMiles: 0,
                        totalMiles: 0,
                        percent: 0
                    });
                    continue;
                }

                // City road network: fetch by bbox, then keep ways whose
                // first node falls inside the city polygon.
                console.log(`${ts()} Stats: fetching road network for ${entry.city} (bbox ${JSON.stringify(cityPoly.bbox)})`);
                const cityOSM = await fetchOSMData(cityPoly.bbox);
                const networkPolys = networkPolylinesFromOSM(cityOSM);

                const insidePolys = networkPolys.filter(p => {
                    // sample mid-point of the polyline for in/out test
                    const mid = p[Math.floor(p.length / 2)];
                    return pointInPolygon(mid[0], mid[1], cityPoly.polygon);
                });
                const totalNetCells = buildCoverageCells(insidePolys);
                const totalMiles = cellsToMiles(totalNetCells.size);

                // Ridden cells inside this city's polygon
                const cityRiddenCells = filterCellsByPolygon(totalCells, cityPoly.polygon);
                const riddenInCity = new Set<string>();
                for (const k of cityRiddenCells) {
                    if (totalNetCells.has(k)) riddenInCity.add(k);
                }
                const riddenMiles = cellsToMiles(riddenInCity.size);

                const percent = totalMiles > 0 ? (riddenMiles / totalMiles) * 100 : 0;
                cities.push({
                    name: entry.city,
                    state: entry.state,
                    activityCount: entry.activityIdx.length,
                    riddenMiles,
                    totalMiles,
                    percent
                });
            } catch (e: any) {
                console.warn(`${ts()} city stats failed for ${entry.city}:`, e?.message || e);
                cities.push({
                    name: entry.city,
                    state: entry.state,
                    activityCount: entry.activityIdx.length,
                    riddenMiles: 0,
                    totalMiles: 0,
                    percent: 0
                });
            }
        }

        const response: StatsResponse = {
            totalActivities: riddenRoads.length,
            totalUniqueMiles,
            cities
        };
        return NextResponse.json(response);
    } catch (error: any) {
        console.error('Stats route error:', error);
        return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
    }
}
