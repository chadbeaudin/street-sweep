import { Encoder, Profile } from '@garmin/fitsdk';

/**
 * Converts decimal degrees to Garmin's semicircle unit system.
 * Garmin uses 2^31 semicircles per 180 degrees.
 */
function toSemicircles(degrees: number): number {
    return Math.round(degrees * (2 ** 31 / 180));
}

/**
 * Generates a FIT course file buffer from a route coordinate array.
 * @param route - Array of [lon, lat, ele?] coordinates
 * @param name  - Human-readable course name (shown on device)
 * @returns Uint8Array containing the complete .fit file
 */
export function buildFitCourse(route: [number, number, number?, number?][], name: string = 'StreetSweep Course'): Uint8Array {
    const encoder = new Encoder();
    const now = new Date();

    // FIT epoch is Jan 1, 1990. We need seconds since FIT epoch.
    const FIT_EPOCH_OFFSET_S = 631065600; // seconds between Unix and FIT epoch
    const startTimestamp = Math.floor(Date.now() / 1000) - FIT_EPOCH_OFFSET_S;

    // 1. File ID message — required first message in every FIT file
    encoder.onMesg(Profile.MesgNum.FILE_ID, {
        type: 'course',
        manufacturer: 'development',
        product: 0,
        serialNumber: 0,
        timeCreated: now,
    });

    // 2. Course message — course header
    encoder.onMesg(Profile.MesgNum.COURSE, {
        name,
        sport: 'cycling',
    });

    // 3. Lap message — required summary wrapper for the course
    // Calculate total distance using the Haversine formula
    let totalDistanceM = 0;
    for (let i = 1; i < route.length; i++) {
        totalDistanceM += haversineMeters(
            route[i - 1][1], route[i - 1][0],
            route[i][1], route[i][0]
        );
    }

    encoder.onMesg(Profile.MesgNum.LAP, {
        startTime: now,
        totalDistance: totalDistanceM,
        totalElapsedTime: 0,
        totalTimerTime: 0,
    });

    // 4. Record messages — one per coordinate (the breadcrumb trail)
    let accumulatedDistanceM = 0;
    let prevPoint: [number, number] | null = null;
    let timestamp = startTimestamp;

    for (const point of route) {
        const [lon, lat, ele] = point;

        if (prevPoint) {
            accumulatedDistanceM += haversineMeters(prevPoint[1], prevPoint[0], lat, lon);
        }

        const record: Record<string, unknown> = {
            timestamp: new Date(timestamp * 1000 + 631065600000),
            positionLat: toSemicircles(lat),
            positionLong: toSemicircles(lon),
            distance: accumulatedDistanceM,
        };

        if (ele !== undefined && ele !== null) {
            record.altitude = ele;
        }

        encoder.onMesg(Profile.MesgNum.RECORD, record);

        prevPoint = [lon, lat];
        timestamp += 1; // 1 second per record (approximate)
    }

    return encoder.close();
}

/**
 * Haversine distance between two lat/lon points in meters.
 */
function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371000;
    const φ1 = lat1 * Math.PI / 180;
    const φ2 = lat2 * Math.PI / 180;
    const Δφ = (lat2 - lat1) * Math.PI / 180;
    const Δλ = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
