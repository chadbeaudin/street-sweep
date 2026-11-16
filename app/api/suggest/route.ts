import { withApiMetrics } from '@/lib/metrics';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { errorResponse } from '@/lib/apiErrors';
import { fetchRideTracks } from '@/lib/strava';
import { fetchOSMData } from '@/lib/overpass';
import { fetchElevationData } from '@/lib/elevationFetch';
import { StreetGraph, filterRiddenRoadsToBbox } from '@/lib/graph';
import { polylineSetFingerprint } from '@/lib/riddenRoads';
import { resolveRequestStravaCredentials } from '@/lib/serverStravaCredentials';
import { findMostCommonRide, legsAlong, waypointSpacingM } from '@/lib/suggestRoute';
import { planLoop, loopReachM, cachedRideGainM, activeAvoidPreferences, hamperedNote } from '@/lib/suggestLoop';
import { LatLon, RoutingOptions, parseBody } from '@/lib/validation';

const M_PER_DEG = 111_320;
// Overpass refuses boxes over 0.5° a side (lib/overpass.ts).
const MAX_HALF_SPAN_DEG = 0.22;

const Body = z.object({
    start: LatLon,
    activityMode: z.enum(['cycling', 'running']).optional(),
    routingOptions: RoutingOptions,
});

// "Suggest a Route" (#80): a loop from the chosen start matching the distance and
// climbing of the rider's most common ride (from near there, else anywhere), on
// unridden streets where it can. Returned as waypoints with the routed path between them.
async function handlePOST(request: Request) {
    try {
        const creds = await resolveRequestStravaCredentials();
        if (!creds) return NextResponse.json({ error: 'Sign in with Strava first' }, { status: 401 });

        const parsed = await parseBody(request, Body);
        if ('error' in parsed) return parsed.error;
        const { start, activityMode, routingOptions } = parsed.data;

        const rides = await fetchRideTracks(creds, activityMode ?? 'cycling');
        const common = findMostCommonRide(rides, start) ?? findMostCommonRide(rides, start, Infinity);
        if (!common) {
            return NextResponse.json({ error: 'No rides to base a suggestion on yet. Sync some rides from Strava first.' }, { status: 404 });
        }
        const { ride } = common;
        const elevationsFor = async (lonLats: [number, number][]) => (await fetchElevationData(lonLats)).elevations;
        const target = { distanceM: ride.distanceM, gainM: await cachedRideGainM(ride.id, ride.poly, elevationsFor) };

        const halfLat = Math.min(MAX_HALF_SPAN_DEG, (loopReachM(target) + 1500) / M_PER_DEG);
        const halfLon = Math.min(MAX_HALF_SPAN_DEG, halfLat / Math.cos(start.lat * Math.PI / 180));
        const bbox = { south: start.lat - halfLat, north: start.lat + halfLat, west: start.lon - halfLon, east: start.lon + halfLon };
        const ridden = filterRiddenRoadsToBbox(rides.map(r => r.poly), bbox) ?? [];
        const graph = await StreetGraph.getCachedGraphAsync(bbox, await fetchOSMData(bbox), ridden, routingOptions,
            StreetGraph.reuseKey(polylineSetFingerprint(ridden), routingOptions));
        const riddenPenalties = graph.buildRiddenPenaltyMap(routingOptions?.pointRoutePenalty || 4);

        const loop = await planLoop(graph, start, target, riddenPenalties, elevationsFor);
        const preferences = activeAvoidPreferences(routingOptions);
        if (!loop) {
            const hint = preferences.length > 0 ? ` Your routing preferences may be ruling roads out: ${preferences.join(', ')}.` : '';
            return NextResponse.json({ error: `Couldn't find streets to ride from there. Try a start point on a road.${hint}` }, { status: 404 });
        }

        // The legs are the loop as planned and scored, so the client draws them as they are;
        // routing the waypoints a second time gave a different, longer route (#224).
        const { waypoints, legs } = legsAlong(loop.path, waypointSpacingM(loop.distanceM));
        return NextResponse.json({ waypoints, legs, note: hamperedNote(loop, target, preferences) });
    } catch (error: any) {
        return errorResponse(error, 'Suggest route error:', "Couldn't suggest a route. Try again in a moment.");
    }
}

export const POST = withApiMetrics('POST', '/api/suggest', handlePOST);
