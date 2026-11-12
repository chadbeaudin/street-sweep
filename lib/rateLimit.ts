import { NextResponse } from 'next/server';

const WINDOW_MS = 60 * 1000;

// Requests per client IP per minute (#193). Sized well above what the app's own
// UI sends (step/roads fire per click/pan) so only scripted floods hit them.
export const RATE_LIMITS = {
    step: 120,
    roads: 180,
    generate: 30,
    geocode: 30,
    snap: 60,
    path: 60,
    import: 10,
    exportFit: 20,
} as const;

export type RateLimitName = keyof typeof RATE_LIMITS;

// In memory: prod runs a single Fly machine, and a suspend/restart resetting the
// counts is acceptable at this scale.
const windows = new Map<string, { count: number; resetAt: number }>();
let nextSweep = 0;

// Fly's proxy sets Fly-Client-IP and overwrites any client-sent value; the
// X-Forwarded-For fallback only applies off Fly (local dev, the worker).
export function clientIp(request: Request): string {
    return request.headers.get('fly-client-ip')
        ?? request.headers.get('x-forwarded-for')?.split(',')[0].trim()
        ?? 'unknown';
}

// Seconds until the caller may retry, or null when the request is allowed.
export function consume(key: string, limit: number, now = Date.now()): number | null {
    if (now >= nextSweep) {
        for (const [k, w] of windows) if (now >= w.resetAt) windows.delete(k);
        nextSweep = now + WINDOW_MS;
    }
    const w = windows.get(key);
    if (!w || now >= w.resetAt) {
        windows.set(key, { count: 1, resetAt: now + WINDOW_MS });
        return null;
    }
    if (w.count >= limit) return Math.ceil((w.resetAt - now) / 1000);
    w.count++;
    return null;
}

export function resetRateLimits(): void {
    windows.clear();
    nextSweep = 0;
}

export function withRateLimit<Q extends Request, A extends unknown[], R>(name: RateLimitName, handler: (request: Q, ...rest: A) => Promise<R>): (request: Q, ...rest: A) => Promise<R | NextResponse> {
    return async (request, ...rest) => {
        const retryAfter = consume(`${name}:${clientIp(request)}`, RATE_LIMITS[name]);
        if (retryAfter !== null) {
            return NextResponse.json(
                { error: `Too many requests. Try again in ${retryAfter} seconds.` },
                { status: 429, headers: { 'Retry-After': String(retryAfter) } },
            );
        }
        return handler(request, ...rest);
    };
}
