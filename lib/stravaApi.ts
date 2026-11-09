import { incrementMetric } from './metrics';

// Every Strava call goes through here so the app-wide rate limit, shared by
// prod, the worker and local dev (#148), shows up in the logs as it's spent.
// Strava reports "15-minute,daily" pairs: overall, and for reads since 2023.
export function describeRateLimit(headers: Headers | undefined): string | null {
    const pair = (usage: string, limit: string) => {
        const u = headers?.get(usage)?.split(',');
        const l = headers?.get(limit)?.split(',');
        return u && l ? `${u[0]}/${l[0]} 15m, ${u[1]}/${l[1]} day` : null;
    };
    const parts = [
        pair('x-ratelimit-usage', 'x-ratelimit-limit'),
        pair('x-readratelimit-usage', 'x-readratelimit-limit'),
    ];
    const [all, read] = parts;
    if (!all && !read) return null;
    return [all && `rate ${all}`, read && `read ${read}`].filter(Boolean).join(' · ');
}

// Activity, gear and athlete ids become ":id" so lines for different rides read alike.
const endpointOf = (url: string) => new URL(url).pathname.replace(/\/\d+(?=\/|$)/g, '/:id');

export async function stravaFetch(url: string, init?: RequestInit): Promise<Response> {
    const res = await fetch(url, init);
    const method = init?.method ?? 'GET';
    const line = `[Strava] ${method} ${endpointOf(url)} ${res.status}`;
    const usage = describeRateLimit(res.headers);
    incrementMetric('strava.requests');
    if (res.status === 429) {
        incrementMetric('strava.429');
        console.warn(`${line} RATE LIMITED${usage ? ` · ${usage}` : ''}`);
    } else {
        console.log(usage ? `${line} · ${usage}` : line);
    }
    return res;
}
