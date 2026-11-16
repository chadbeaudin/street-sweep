import type { StreetGraph } from './graph';
import { calculateElevationGainLoss } from './elevation';
import { haversineM } from './geometry';

// "Suggest a Route" (#80): a loop from the chosen start that matches the rider's
// usual distance first and elevation gain second (going well over hurts more
// than coming in under), preferring unridden streets. Shape doesn't matter.

export interface LoopTarget { distanceM: number; gainM: number }
export interface LoopResult { path: [number, number][]; distanceM: number; gainM: number; unriddenFraction: number; score: number }

const M_PER_DEG = 111_320;
// Roads wander: a triangle of straight sides r long rides about 1.3 × 3r.
const ROAD_FACTOR = 1.3;
const DIRECTIONS = 8;
// Each later leg avoids streets an earlier leg already used, so the loop doesn't double back.
const REUSE_PENALTY = 5;
// Elevation gain noise filter in metres, as the FIT export uses.
const GAIN_THRESHOLD_M = 4.5;
// Gains below this count as this, so a flat usual ride doesn't make every hill look huge.
const MIN_GAIN_SCALE_M = 60;

export function offsetPoint(start: { lat: number; lon: number }, distM: number, bearingDeg: number): { lat: number; lon: number } {
    const b = bearingDeg * Math.PI / 180;
    return {
        lat: start.lat + (distM * Math.cos(b)) / M_PER_DEG,
        lon: start.lon + (distM * Math.sin(b)) / (M_PER_DEG * Math.cos(start.lat * Math.PI / 180)),
    };
}

// Lower is better. Distance first, then climbing -- going over costs twice what
// coming in under does -- and unridden streets only break near-ties.
export function scoreLoop(loop: { distanceM: number; gainM: number; unriddenFraction: number }, target: LoopTarget): number {
    const distanceError = Math.abs(loop.distanceM - target.distanceM) / target.distanceM;
    const gainScale = Math.max(target.gainM, MIN_GAIN_SCALE_M);
    const over = Math.max(0, loop.gainM - target.gainM) / gainScale;
    const under = Math.max(0, target.gainM - loop.gainM) / gainScale;
    return 4 * distanceError + 2 * over + under - 0.2 * loop.unriddenFraction;
}

// How far out a candidate loop's corners can reach, so the caller can size the street graph.
export function loopReachM(target: LoopTarget): number {
    return (target.distanceM / (3 * ROAD_FACTOR)) * 1.6;
}

// Routes start → A → B → start, with A and B `r` out at ±30° of `bearing`.
function routeTriangle(graph: StreetGraph, network: Set<string>, start: { lat: number; lon: number }, r: number, bearing: number, riddenPenalties: Map<string, number>) {
    const corners = [start, offsetPoint(start, r, bearing - 30), offsetPoint(start, r, bearing + 30), start];
    const nodes = corners.map(c => graph.findClosestNode(c.lat, c.lon, network));
    if (nodes.some(n => !n)) return null;

    const penalties = new Map(riddenPenalties);
    const path: [number, number][] = [];
    let distanceM = 0;
    let unriddenM = 0;
    for (let i = 1; i < nodes.length; i++) {
        if (nodes[i - 1] === nodes[i]) continue;
        const leg = graph.findClosestTargetCapped(nodes[i - 1]!, new Set([nodes[i]!]), penalties);
        if (!leg) return null;
        for (const step of leg.path) {
            const link = graph.graph.getLink(step.id, step.idNext);
            if (!link) continue;
            distanceM += link.data.weight;
            if (!link.data.isRidden) unriddenM += link.data.weight;
            penalties.set(link.id, (penalties.get(link.id) ?? 1) * REUSE_PENALTY);
            const back = graph.graph.getLink(step.idNext, step.id);
            if (back) penalties.set(back.id, (penalties.get(back.id) ?? 1) * REUSE_PENALTY);
            const from = graph.graph.getNode(step.id)!.data;
            if (path.length === 0) path.push([from.lat, from.lon]);
            const to = graph.graph.getNode(step.idNext)!.data;
            path.push([to.lat, to.lon]);
        }
    }
    if (path.length < 2) return null;
    return { path, distanceM, unriddenFraction: distanceM > 0 ? unriddenM / distanceM : 0 };
}

// Coarse enough to keep elevation lookups few, fine enough to compare whole loops' climbing (#223).
const SAMPLE_SPACING_M = 200;
// Climbing is only measured for this many loops before the rest must show they could still win.
const ALWAYS_MEASURED = 3;

// Takes [lat, lon] points; returns [lon, lat] for the elevation fetch.
function sampleForElevation(path: [number, number][]): [number, number][] {
    const out: [number, number][] = [[path[0][1], path[0][0]]];
    let since = 0;
    for (let i = 1; i < path.length; i++) {
        since += haversineM(path[i - 1][0], path[i - 1][1], path[i][0], path[i][1]);
        if (since >= SAMPLE_SPACING_M || i === path.length - 1) { out.push([path[i][1], path[i][0]]); since = 0; }
    }
    return out;
}

// Climbing measured from map elevation data, so the rider's usual ride and every
// candidate are compared the same way (Strava's own gain figure is measured differently).
export async function measureGainM(path: [number, number][], elevationsFor: (lonLats: [number, number][]) => Promise<number[]>): Promise<number> {
    return calculateElevationGainLoss(await elevationsFor(sampleForElevation(path)), GAIN_THRESHOLD_M).gain;
}

// A ride's track never changes, and the same usual ride is the target of every suggestion nearby.
const rideGainCache = new Map<number, number>();
export async function cachedRideGainM(rideId: number, path: [number, number][], elevationsFor: (lonLats: [number, number][]) => Promise<number[]>): Promise<number> {
    const cached = rideGainCache.get(rideId);
    if (cached !== undefined) return cached;
    const gainM = await measureGainM(path, elevationsFor);
    rideGainCache.set(rideId, gainM);
    return gainM;
}

// The best score a loop could get if its climbing matched the target exactly.
function bestPossibleScore(loop: { distanceM: number; unriddenFraction: number }, target: LoopTarget): number {
    return scoreLoop({ ...loop, gainM: target.gainM }, target);
}

// Tries a loop in each direction, resizing it once so its routed length lands on
// the target, then scores the sized loops with their elevation gain.
export async function planLoop(
    graph: StreetGraph,
    start: { lat: number; lon: number },
    target: LoopTarget,
    riddenPenalties: Map<string, number>,
    elevationsFor: (lonLats: [number, number][]) => Promise<number[]>,
): Promise<LoopResult | null> {
    const firstR = target.distanceM / (3 * ROAD_FACTOR);
    const maxR = loopReachM(target);
    // Snapping onto a stray path fragment would leave no way to reach the other corners.
    const network = graph.largestConnectedComponent();
    const candidates: { path: [number, number][]; distanceM: number; unriddenFraction: number }[] = [];
    for (let k = 0; k < DIRECTIONS; k++) {
        const bearing = (360 / DIRECTIONS) * k;
        // Each direction is a few searches over a large graph; let other requests in between them (#216).
        await new Promise(resolve => setImmediate(resolve));
        const first = routeTriangle(graph, network, start, firstR, bearing, riddenPenalties);
        if (!first) continue;
        const resizedR = Math.min(maxR, firstR * target.distanceM / first.distanceM);
        const resized = routeTriangle(graph, network, start, resizedR, bearing, riddenPenalties);
        const bestFit = [first, resized].filter(c => c !== null)
            .sort((a, b) => Math.abs(a!.distanceM - target.distanceM) - Math.abs(b!.distanceM - target.distanceM))[0]!;
        candidates.push(bestFit);
    }
    if (candidates.length === 0) return null;

    // Elevation lookups are the slow part (#223), so measure the loops closest on distance
    // first, then only those whose perfect-climbing score could still beat the best of them.
    const byDistanceFit = candidates.map((_, i) => i)
        .sort((a, b) => Math.abs(candidates[a].distanceM - target.distanceM) - Math.abs(candidates[b].distanceM - target.distanceM));
    const scored = new Map<number, LoopResult>();
    const measure = async (indexes: number[]) => {
        const gains = await Promise.all(indexes.map(i => measureGainM(candidates[i].path, elevationsFor)));
        indexes.forEach((i, k) => {
            const loop = { ...candidates[i], gainM: gains[k] };
            scored.set(i, { ...loop, score: scoreLoop(loop, target) });
        });
    };
    await measure(byDistanceFit.slice(0, ALWAYS_MEASURED));
    const scoreToBeat = Math.min(...[...scored.values()].map(l => l.score));
    await measure(byDistanceFit.slice(ALWAYS_MEASURED).filter(i => bestPossibleScore(candidates[i], target) <= scoreToBeat));

    let best: LoopResult | null = null;
    for (let i = 0; i < candidates.length; i++) {
        const loop = scored.get(i);
        if (!loop) {
            console.log(`[Suggest] candidate ${i}: ${(candidates[i].distanceM / 1000).toFixed(1)} km, cannot beat the best, climbing not measured`);
            continue;
        }
        console.log(`[Suggest] candidate ${i}: ${(loop.distanceM / 1000).toFixed(1)} km, ${Math.round(loop.gainM)} m gain, ${Math.round(loop.unriddenFraction * 100)}% unridden, score ${loop.score.toFixed(2)}`);
        if (!best || loop.score < best.score) best = loop;
    }
    return best;
}
