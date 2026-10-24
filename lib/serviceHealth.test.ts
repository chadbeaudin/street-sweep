const mockQuery = jest.fn();
const mockSend = jest.fn();
jest.mock('./prisma', () => ({ prisma: { $queryRawUnsafe: (...a: unknown[]) => mockQuery(...a) } }));
jest.mock('./telegram', () => ({ sendTelegramMessage: (...a: unknown[]) => mockSend(...a) }));

type Health = typeof import('./serviceHealth');
let checkServices: Health['checkServices'];
let topoUp: boolean;

beforeEach(() => {
    process.env.OVERPASS_URL = 'https://overpass.test/api/interpreter';
    process.env.OPEN_TOPO_URL = 'https://topo.test';
    topoUp = true;
    mockQuery.mockResolvedValue([{ '?column?': 1 }]);
    mockSend.mockResolvedValue(true);
    global.fetch = jest.fn(async (url: string) => ({ ok: !url.startsWith('https://topo.test') || topoUp, status: 502 })) as unknown as typeof fetch;
    jest.isolateModules(() => { ({ checkServices } = require('./serviceHealth')); });
});

describe('checkServices (#129)', () => {
    it('reports every self-hosted service up, probing Overpass at its status endpoint', async () => {
        expect(await checkServices(0)).toEqual({ database: true, overpass: true, elevation: true });
        expect(global.fetch).toHaveBeenCalledWith('https://overpass.test/api/status', expect.anything());
        expect(mockSend).not.toHaveBeenCalled();
    });

    it('flags a failing service and alerts once per outage, then on recovery', async () => {
        mockQuery.mockRejectedValue(new Error('connect ECONNREFUSED'));
        topoUp = false;
        expect(await checkServices(0)).toEqual({ database: false, overpass: true, elevation: false });
        expect(mockSend).toHaveBeenCalledTimes(1);
        expect(mockSend.mock.calls[0][0]).toBe('StreetSweep: Postgres is DOWN (connect ECONNREFUSED)\nStreetSweep: Open Topo Data is DOWN (HTTP 502)');

        await checkServices(60_000);
        expect(mockSend).toHaveBeenCalledTimes(1);

        mockQuery.mockResolvedValue([]);
        topoUp = true;
        expect(await checkServices(10 * 60_000)).toEqual({ database: true, overpass: true, elevation: true });
        expect(mockSend).toHaveBeenLastCalledWith('StreetSweep: Postgres is back up after 10 min\nStreetSweep: Open Topo Data is back up after 10 min');
    });

    it('reuses a recent result so page loads do not hammer the backends', async () => {
        await checkServices(0);
        await checkServices(10_000);
        expect(mockQuery).toHaveBeenCalledTimes(1);
        await checkServices(31_000);
        expect(mockQuery).toHaveBeenCalledTimes(2);
    });

    it('treats a hung database as down', async () => {
        jest.useFakeTimers();
        mockQuery.mockReturnValue(new Promise(() => {}));
        const result = checkServices(0);
        await jest.advanceTimersByTimeAsync(4000);
        expect((await result).database).toBe(false);
        jest.useRealTimers();
    });
});
