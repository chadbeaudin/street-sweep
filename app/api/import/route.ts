import { NextResponse } from 'next/server';
import { calculateElevationProfile } from '@/lib/elevation';

type Coord = [number, number] | [number, number, number]; // [lon, lat] | [lon, lat, ele]

const SEMICIRCLES_TO_DEG = 180 / Math.pow(2, 31);

function parseFit(buffer: Buffer): Coord[] {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Decoder, Stream } = require('@garmin/fitsdk');
    const stream = Stream.fromBuffer(buffer);
    const decoder = new Decoder(stream);
    const { messages } = decoder.read();

    const records: any[] = messages.recordMesgs ?? [];
    const coords: Coord[] = [];

    for (const r of records) {
        if (r.positionLat == null || r.positionLong == null) continue;
        const lat = r.positionLat * SEMICIRCLES_TO_DEG;
        const lon = r.positionLong * SEMICIRCLES_TO_DEG;
        if (r.altitude != null) {
            coords.push([lon, lat, r.altitude]);
        } else {
            coords.push([lon, lat]);
        }
    }
    return coords;
}

function parseGpx(text: string): Coord[] {
    const coords: Coord[] = [];
    const trkptRe = /<trkpt\b[^>]*\blat="([^"]+)"[^>]*\blon="([^"]+)"[^>]*>([\s\S]*?)<\/trkpt>/g;
    let m: RegExpExecArray | null;
    while ((m = trkptRe.exec(text)) !== null) {
        const lat = parseFloat(m[1]);
        const lon = parseFloat(m[2]);
        const eleMatch = /<ele>([^<]+)<\/ele>/.exec(m[3]);
        coords.push(eleMatch ? [lon, lat, parseFloat(eleMatch[1])] : [lon, lat]);
    }
    if (coords.length === 0) {
        const rteptRe = /<rtept\b[^>]*\blat="([^"]+)"[^>]*\blon="([^"]+)"[^>]*>([\s\S]*?)<\/rtept>/g;
        while ((m = rteptRe.exec(text)) !== null) {
            const lat = parseFloat(m[1]);
            const lon = parseFloat(m[2]);
            const eleMatch = /<ele>([^<]+)<\/ele>/.exec(m[3]);
            coords.push(eleMatch ? [lon, lat, parseFloat(eleMatch[1])] : [lon, lat]);
        }
    }
    return coords;
}

function parseTcx(text: string): Coord[] {
    const coords: Coord[] = [];
    const tpRe = /<Trackpoint>([\s\S]*?)<\/Trackpoint>/g;
    let m: RegExpExecArray | null;
    while ((m = tpRe.exec(text)) !== null) {
        const body = m[1];
        const latMatch = /<LatitudeDegrees>([^<]+)<\/LatitudeDegrees>/.exec(body);
        const lonMatch = /<LongitudeDegrees>([^<]+)<\/LongitudeDegrees>/.exec(body);
        if (!latMatch || !lonMatch) continue;
        const lat = parseFloat(latMatch[1]);
        const lon = parseFloat(lonMatch[1]);
        const eleMatch = /<AltitudeMeters>([^<]+)<\/AltitudeMeters>/.exec(body);
        coords.push(eleMatch ? [lon, lat, parseFloat(eleMatch[1])] : [lon, lat]);
    }
    return coords;
}

export async function POST(request: Request) {
    try {
        const formData = await request.formData();
        const file = formData.get('file') as File | null;
        if (!file) {
            return NextResponse.json({ error: 'No file provided' }, { status: 400 });
        }

        const name = file.name.toLowerCase();
        let coords: Coord[] = [];

        if (name.endsWith('.fit')) {
            const arrayBuffer = await file.arrayBuffer();
            coords = parseFit(Buffer.from(arrayBuffer));
        } else if (name.endsWith('.gpx')) {
            coords = parseGpx(await file.text());
        } else if (name.endsWith('.tcx')) {
            coords = parseTcx(await file.text());
        } else {
            return NextResponse.json({ error: 'Unsupported file type. Use .gpx, .tcx, or .fit' }, { status: 400 });
        }

        if (coords.length < 2) {
            return NextResponse.json({ error: 'Route file contains fewer than 2 valid coordinates' }, { status: 422 });
        }

        const lonLats = coords.map(c => [c[0], c[1]] as [number, number]);
        const elevations = coords.map(c => (c.length > 2 ? (c as [number, number, number])[2] : 0));
        const elevationProfile = calculateElevationProfile(lonLats, elevations);
        const totalDistance = elevationProfile[elevationProfile.length - 1]?.distance ?? 0;

        return NextResponse.json({ coordinates: coords, elevationProfile, totalDistance: totalDistance.toFixed(2) });
    } catch (err: any) {
        console.error('Route import error:', err);
        return NextResponse.json({ error: err.message || 'Failed to parse route file' }, { status: 500 });
    }
}
