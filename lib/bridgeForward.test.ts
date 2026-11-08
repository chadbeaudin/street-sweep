import { createdActivityIds, forwardToBridge } from './bridgeForward';

const ORIGINAL_ENV = process.env;
const event = (aspect: string, activityId: string | null) => ({ id: 1, athleteId: '42', aspect, activityId, mode: null, credsEncrypted: null, attempts: 0, availableAt: new Date(0), createdAt: new Date(0), claimedAt: null }) as any;
const stravaActivity = { id: 7, start_date: '2026-11-02T16:00:00Z', device_name: 'MyWhoosh', sport_type: 'VirtualRide', total_photo_count: 1, name: 'ride' };

beforeEach(() => {
    process.env = { ...ORIGINAL_ENV, BRIDGE_URL: 'http://bridge:8095/events', BRIDGE_SECRET: 's3cret', BRIDGE_ATHLETE_ID: '42' };
    global.fetch = jest.fn()
        .mockResolvedValueOnce({ ok: true, json: async () => stravaActivity })
        .mockResolvedValue({ ok: true });
    jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterAll(() => { process.env = ORIGINAL_ENV; });

describe('createdActivityIds (#138)', () => {
    it('keeps creates, even when an update follows, and drops ones deleted again', () => {
        expect(createdActivityIds([event('create', '1'), event('update', '1'), event('create', '2'), event('delete', '2'), event('update', '3'), event('resync', null)]))
            .toEqual(['1']);
    });
});

describe('forwardToBridge (#138)', () => {
    it('fetches the new activity and posts its identifying fields and name with the shared secret', async () => {
        await forwardToBridge('42', 'token', [event('create', '7')]);
        const [stravaUrl, stravaInit] = (global.fetch as jest.Mock).mock.calls[0];
        expect(stravaUrl).toBe('https://www.strava.com/api/v3/activities/7');
        expect(stravaInit.headers.Authorization).toBe('Bearer token');
        const [url, init] = (global.fetch as jest.Mock).mock.calls[1];
        expect(url).toBe('http://bridge:8095/events');
        expect(init.headers['X-Bridge-Secret']).toBe('s3cret');
        expect(JSON.parse(init.body)).toEqual({
            id: 7, athlete_id: 42, aspect_type: 'create', start_date: '2026-11-02T16:00:00Z',
            device_name: 'MyWhoosh', sport_type: 'VirtualRide', total_photo_count: 1, name: 'ride',
        });
    });

    it('does nothing for other athletes or until configured', async () => {
        await forwardToBridge('99', 'token', [event('create', '7')]);
        delete process.env.BRIDGE_URL;
        await forwardToBridge('42', 'token', [event('create', '7')]);
        expect(global.fetch).not.toHaveBeenCalled();
    });

    it('ignores updates and deletes', async () => {
        await forwardToBridge('42', 'token', [event('update', '7'), event('delete', '8')]);
        expect(global.fetch).not.toHaveBeenCalled();
    });

    it('swallows bridge and Strava failures so the sync carries on', async () => {
        (global.fetch as jest.Mock).mockReset().mockRejectedValue(new Error('connect ECONNREFUSED'));
        await expect(forwardToBridge('42', 'token', [event('create', '7'), event('create', '8')])).resolves.toBeUndefined();
        expect(global.fetch).toHaveBeenCalledTimes(2);
        (global.fetch as jest.Mock).mockReset().mockResolvedValue({ ok: false, status: 500 });
        await expect(forwardToBridge('42', 'token', [event('create', '7')])).resolves.toBeUndefined();
    });
});
