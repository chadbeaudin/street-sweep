import { consume, clientIp, withRateLimit, resetRateLimits, RATE_LIMITS } from './rateLimit';
import * as metrics from './metrics';

const T = 1_000_000;
const req = (headers: Record<string, string> = {}) => new Request('http://localhost/api/test', { method: 'POST', headers });

beforeEach(() => resetRateLimits());

describe('consume (#193)', () => {
    it('allows up to the limit in a window, then reports seconds until it resets', () => {
        for (let i = 0; i < 3; i++) expect(consume('k', 3, T + i)).toBeNull();
        expect(consume('k', 3, T + 15_000)).toBe(45);
    });

    it('starts a fresh window once the minute is up', () => {
        for (let i = 0; i < 3; i++) consume('k', 3, T);
        expect(consume('k', 3, T + 60_000)).toBeNull();
    });

    it('counts each key separately', () => {
        consume('a', 1, T);
        expect(consume('a', 1, T)).not.toBeNull();
        expect(consume('b', 1, T)).toBeNull();
    });

    it('drops expired windows so idle clients do not accumulate', () => {
        consume('old', 1, T);
        consume('trigger', 1, T + 60_000);
        // A dropped window means the old key starts over rather than staying blocked.
        expect(consume('old', 1, T + 60_001)).toBeNull();
    });
});

describe('clientIp (#193)', () => {
    it('prefers the address Fly\'s proxy reports', () => {
        expect(clientIp(req({ 'fly-client-ip': '1.1.1.1', 'x-forwarded-for': '2.2.2.2' }))).toBe('1.1.1.1');
    });

    it('falls back to the first X-Forwarded-For entry, then a shared bucket', () => {
        expect(clientIp(req({ 'x-forwarded-for': '2.2.2.2, 10.0.0.1' }))).toBe('2.2.2.2');
        expect(clientIp(req())).toBe('unknown');
    });
});

describe('withRateLimit (#193)', () => {
    const handler = jest.fn(async () => new Response('ok'));

    beforeEach(() => handler.mockImplementation(async () => new Response('ok')));

    it('passes requests through until the client hits the route\'s limit, then answers 429 with Retry-After', async () => {
        const limited = withRateLimit('import', handler);
        const ip = { 'fly-client-ip': '1.1.1.1' };
        for (let i = 0; i < RATE_LIMITS.import; i++) expect((await limited(req(ip))).status).toBe(200);

        const res = await limited(req(ip));
        expect(res.status).toBe(429);
        expect(Number(res.headers.get('Retry-After'))).toBeGreaterThan(0);
        expect((await res.json()).error).toMatch(/Too many requests/);
        expect(handler).toHaveBeenCalledTimes(RATE_LIMITS.import);
    });

    it('limits each client and each route independently', async () => {
        const importLimited = withRateLimit('import', handler);
        for (let i = 0; i < RATE_LIMITS.import; i++) await importLimited(req({ 'fly-client-ip': '1.1.1.1' }));

        expect((await importLimited(req({ 'fly-client-ip': '2.2.2.2' }))).status).toBe(200);
        expect((await withRateLimit('generate', handler)(req({ 'fly-client-ip': '1.1.1.1' }))).status).toBe(200);
    });
});

describe('withRateLimit metrics (#117)', () => {
    it('counts each rejected request against its route', async () => {
        const counted = jest.spyOn(metrics, 'incrementMetric');
        const limited = withRateLimit('import', jest.fn(async () => new Response('ok')));
        for (let i = 0; i <= RATE_LIMITS.import; i++) await limited(req({ 'fly-client-ip': '9.9.9.9' }));
        expect(counted.mock.calls.filter(([name]) => name === 'ratelimit.import')).toHaveLength(1);
    });
});
