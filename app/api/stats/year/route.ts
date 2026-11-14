import { withApiMetrics } from '@/lib/metrics';
import { NextResponse } from 'next/server';
import { errorResponse } from '@/lib/apiErrors';
import { fetchActivitiesForYear, fetchGearFrameTypes } from '@/lib/strava';
import { computeYearDetail } from '@/lib/stats';
import { resolveRequestStravaCredentials } from '@/lib/serverStravaCredentials';
import type { ActivityMode, Creds } from '@/lib/riddenRoadsRefresh';

async function handlePOST(request: Request) {
    try {
        const body = await request.json() as { activityMode?: string; year?: unknown };
        const stravaCredentials = await resolveRequestStravaCredentials();
        if (!stravaCredentials) return NextResponse.json({ error: 'Sign in with Strava first' }, { status: 401 });
        const { year } = body;
        if (typeof year !== 'number' || !Number.isInteger(year)) return NextResponse.json({ error: 'A year is required' }, { status: 400 });
        const mode: ActivityMode = body.activityMode === 'running' ? 'running' : 'cycling';

        const activities = await fetchActivitiesForYear(stravaCredentials, mode, year);
        // Without frame types, rides fall back to their activity type rather than failing the page (#165).
        const gearFrameTypes = mode === 'cycling'
            ? await fetchGearFrameTypes(stravaCredentials, activities.map(a => a.gear_id ?? '')).catch(e => {
                console.warn(`Stats year: gear lookup failed: ${e.message}`);
                return new Map<string, number>();
            })
            : new Map<string, number>();
        return NextResponse.json(computeYearDetail(year, activities, gearFrameTypes));
    } catch (error: any) {
        return errorResponse(error, 'Stats year route error:', "Couldn't load that year. Try again in a moment.");
    }
}

export const POST = withApiMetrics('POST', '/api/stats/year', handlePOST);
