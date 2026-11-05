export {};

const mockQuery = jest.fn();
const mockSend = jest.fn();
const mockCertExpiry = jest.fn();
jest.mock('./postgresCert', () => ({ readPostgresCertExpiry: (...a: unknown[]) => mockCertExpiry(...a) }));
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
    mockCertExpiry.mockReset();
    mockCertExpiry.mockResolvedValue(null);
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

describe('Postgres certificate expiry warning (#155)', () => {
    const DAY_MS = 24 * 60 * 60 * 1000;
    const HOUR_MS = 60 * 60 * 1000;

    beforeEach(() => { mockSend.mockClear(); });

    it('warns once when the certificate is within 14 days of expiry', async () => {
        mockCertExpiry.mockResolvedValue(new Date(10 * DAY_MS));
        await checkServices(0);
        expect(mockSend).toHaveBeenCalledTimes(1);
        expect(mockSend).toHaveBeenCalledWith('StreetSweep: Postgres TLS certificate expires in 10 days');

        await checkServices(2 * HOUR_MS);
        expect(mockSend).toHaveBeenCalledTimes(1);
    });

    it('stays quiet while the certificate has plenty of time left', async () => {
        mockCertExpiry.mockResolvedValue(new Date(60 * DAY_MS));
        await checkServices(0);
        expect(mockSend).not.toHaveBeenCalled();
    });

    it('warns again in the next renewal cycle', async () => {
        mockCertExpiry.mockResolvedValue(new Date(10 * DAY_MS));
        await checkServices(0);
        mockCertExpiry.mockResolvedValue(new Date(90 * DAY_MS));
        await checkServices(2 * HOUR_MS);
        expect(mockSend).toHaveBeenCalledTimes(1);

        mockCertExpiry.mockResolvedValue(new Date(4 * HOUR_MS + 5 * DAY_MS));
        await checkServices(4 * HOUR_MS);
        expect(mockSend).toHaveBeenCalledTimes(2);
    });

    it('reads the certificate at most hourly', async () => {
        await checkServices(0);
        await checkServices(31_000);
        expect(mockCertExpiry).toHaveBeenCalledTimes(1);
        await checkServices(HOUR_MS);
        expect(mockCertExpiry).toHaveBeenCalledTimes(2);
    });

    it('leaves an expired certificate to the DOWN alert', async () => {
        mockCertExpiry.mockResolvedValue(new Date(0));
        await checkServices(DAY_MS);
        expect(mockSend).not.toHaveBeenCalled();
    });

    it('never affects service status when the certificate cannot be read', async () => {
        mockCertExpiry.mockRejectedValue(new Error('timed out'));
        expect(await checkServices(0)).toEqual({ database: true, overpass: true, elevation: true });
        expect(mockSend).not.toHaveBeenCalled();
    });
});
