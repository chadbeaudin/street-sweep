import { z } from 'zod';
import { NextResponse } from 'next/server';

// Security-review finding: no request-body schema validation existed on any
// API route -- handlers destructured request.json() and trusted TypeScript
// types, which provide zero runtime protection against malformed/oversized
// input. Shared primitives here, applied to the routes most exposed to
// attacker-controlled complex input. Array caps exist specifically to bound
// resource exhaustion (a giant polyline/point array being parsed, matched,
// or handed to the routing engine), not to constrain legitimate usage --
// real routes/activities/imports never come remotely close to these sizes.

export const LatLon = z.object({
    lat: z.number().finite(),
    lon: z.number().finite(),
});

export const BBox = z.object({
    north: z.number().finite(),
    south: z.number().finite(),
    east: z.number().finite(),
    west: z.number().finite(),
});

// [lat, lon] or [lon, lat, elevation?] depending on call site -- this file
// doesn't care which axis order a given route uses, just that each point is
// 2-3 finite numbers.
export const CoordTuple = z.array(z.number().finite()).min(2).max(3);
export const Polyline = z.array(CoordTuple).max(20_000);
export const PolylineList = z.array(Polyline).max(2_000);

// routingOptions is an evolving, loosely-typed options bag (avoid toggles,
// penalties, user-marked avoided roads, etc.) -- deliberately kept
// passthrough rather than fully modeled here, so this validation doesn't
// have to be updated in lockstep with every new option. Still bounded: an
// object, not an arbitrary type, and callers that embed polylines in it
// (e.g. avoidedRoads) get the same array caps via their own route's schema.
export const RoutingOptions = z.record(z.string(), z.any()).optional();

/**
 * Parses `request.json()` against `schema`, returning either the validated
 * data or a ready-to-return 400 NextResponse. Callers check `'error' in
 * result` and return it directly on failure -- keeps route handlers from
 * repeating the same try/parse/format-error boilerplate.
 */
export async function parseBody<T extends z.ZodTypeAny>(
    request: Request,
    schema: T
): Promise<{ data: z.infer<T> } | { error: NextResponse }> {
    let json: unknown;
    try {
        json = await request.json();
    } catch {
        return { error: NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }) };
    }
    const result = schema.safeParse(json);
    if (!result.success) {
        return { error: NextResponse.json({ error: 'Invalid request body', details: result.error.flatten() }, { status: 400 }) };
    }
    return { data: result.data };
}
