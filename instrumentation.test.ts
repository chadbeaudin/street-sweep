jest.mock('./lib/routeCache', () => ({ clearRouteCache: jest.fn() }));
jest.mock('./lib/metrics', () => ({ processLabel: jest.fn(), recordHeapSample: jest.fn() }));

import { register } from './instrumentation';
import { clearRouteCache } from './lib/routeCache';

const ORIGINAL_ENV = process.env;
beforeEach(() => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(global, 'setInterval').mockReturnValue({ unref: () => {} } as unknown as NodeJS.Timeout);
});
afterEach(() => { process.env = ORIGINAL_ENV; jest.restoreAllMocks(); });

describe('register (#218)', () => {
    it("clears a previous build's cached pages when the Node server starts", async () => {
        process.env = { ...ORIGINAL_ENV, NEXT_RUNTIME: 'nodejs' };
        await register();
        expect(clearRouteCache).toHaveBeenCalled();
    });

    it('leaves the cache alone in the edge runtime', async () => {
        process.env = { ...ORIGINAL_ENV, NEXT_RUNTIME: 'edge' };
        await register();
        expect(clearRouteCache).not.toHaveBeenCalled();
    });
});
