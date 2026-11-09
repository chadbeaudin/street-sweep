jest.mock('./metrics', () => ({ incrementMetric: jest.fn() }));

import { describeRateLimit, stravaFetch } from './stravaApi';
import { incrementMetric } from './metrics';

const headers = (h: Record<string, string>) => new Headers(h);
const respond = (status: number, h: Record<string, string> = {}) => { global.fetch = jest.fn().mockResolvedValue({ status, ok: status < 400, headers: headers(h) }) as any; };

let log: jest.SpyInstance;
let warn: jest.SpyInstance;
beforeEach(() => {
    log = jest.spyOn(console, 'log').mockImplementation(() => {});
    warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => { log.mockRestore(); warn.mockRestore(); });

describe('describeRateLimit', () => {
    it('reports overall and read usage against Strava\'s 15-minute and daily limits', () => {
        expect(describeRateLimit(headers({
            'X-RateLimit-Limit': '200,2000', 'X-RateLimit-Usage': '12,345',
            'X-ReadRateLimit-Limit': '100,1000', 'X-ReadRateLimit-Usage': '9,300',
        }))).toBe('rate 12/200 15m, 345/2000 day · read 9/100 15m, 300/1000 day');
    });

    it('handles a response with only the overall pair', () => {
        expect(describeRateLimit(headers({ 'X-RateLimit-Limit': '200,2000', 'X-RateLimit-Usage': '1,2' }))).toBe('rate 1/200 15m, 2/2000 day');
    });

    it('returns null without rate headers (OAuth, mocks)', () => {
        expect(describeRateLimit(headers({}))).toBeNull();
        expect(describeRateLimit(undefined)).toBeNull();
    });
});

describe('stravaFetch', () => {
    it('logs each call with its endpoint and current usage, and counts it', async () => {
        respond(200, { 'X-RateLimit-Limit': '200,2000', 'X-RateLimit-Usage': '50,900' });
        const res = await stravaFetch('https://www.strava.com/api/v3/activities/16586613049/streams?keys=latlng', { headers: { Authorization: 'Bearer secret-token' } });
        expect(res.status).toBe(200);
        expect(log).toHaveBeenCalledWith('[Strava] GET /api/v3/activities/:id/streams 200 · rate 50/200 15m, 900/2000 day');
        expect(incrementMetric).toHaveBeenCalledWith('strava.requests');
        expect(JSON.stringify(log.mock.calls)).not.toContain('secret-token');
    });

    it('warns and counts a 429 separately', async () => {
        respond(429, { 'X-RateLimit-Limit': '200,2000', 'X-RateLimit-Usage': '201,1500' });
        await stravaFetch('https://www.strava.com/api/v3/athlete');
        expect(warn).toHaveBeenCalledWith('[Strava] GET /api/v3/athlete 429 RATE LIMITED · rate 201/200 15m, 1500/2000 day');
        expect(incrementMetric).toHaveBeenCalledWith('strava.429');
    });

    it('passes the method and request through untouched', async () => {
        respond(200);
        await stravaFetch('https://www.strava.com/api/v3/activities/1', { method: 'PUT', body: '{}' });
        expect(global.fetch).toHaveBeenCalledWith('https://www.strava.com/api/v3/activities/1', { method: 'PUT', body: '{}' });
        expect(log).toHaveBeenCalledWith('[Strava] PUT /api/v3/activities/:id 200');
    });
});
