import { listRoutes, listCollections, fetchRouteGpx, deleteRwgpsRoute, buildLibraryTree, RwgpsRouteSummary } from './rwgps';

const OLD_ENV = process.env;

beforeEach(() => {
    jest.resetAllMocks();
    process.env = { ...OLD_ENV, RWGPS_API_KEY: 'test-api-key' };
    global.fetch = jest.fn();
});

afterAll(() => {
    process.env = OLD_ENV;
});

describe('listRoutes', () => {
    it('follows next_page_url until exhausted', async () => {
        (global.fetch as jest.Mock)
            .mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    routes: [{ id: 1, name: 'A', distance: 1000, url: 'u1' }],
                    meta: { pagination: { next_page_url: 'https://ridewithgps.com/api/v1/routes.json?page=2' } },
                }),
            })
            .mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    routes: [{ id: 2, name: 'B', distance: 2000, url: 'u2' }],
                    meta: { pagination: { next_page_url: null } },
                }),
            });

        const routes = await listRoutes('token');
        expect(routes).toEqual([
            { id: 1, name: 'A', distance: 1000, url: 'u1' },
            { id: 2, name: 'B', distance: 2000, url: 'u2' },
        ]);
        expect(global.fetch).toHaveBeenCalledTimes(2);
    });

    it('throws with status on a failed request', async () => {
        (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: false, status: 401, statusText: 'Unauthorized' });
        await expect(listRoutes('token')).rejects.toThrow('401');
    });
});

describe('listCollections', () => {
    it('fetches each collection detail for its route ids, skipping ones that fail', async () => {
        (global.fetch as jest.Mock)
            .mockResolvedValueOnce({
                ok: true,
                json: async () => ({ collections: [{ id: 10, name: 'Loops' }, { id: 11, name: 'Broken' }] }),
            })
            .mockResolvedValueOnce({
                ok: true,
                json: async () => ({ collection: { routes: [{ id: 1 }, { id: 2 }] } }),
            })
            .mockResolvedValueOnce({ ok: false, status: 404, statusText: 'Not Found' });

        const result = await listCollections('token');
        expect(result).toEqual([
            { collection: { id: 10, name: 'Loops' }, routeIds: [1, 2] },
        ]);
    });
});

describe('fetchRouteGpx', () => {
    it('fetches gpx bytes and the route name in parallel', async () => {
        (global.fetch as jest.Mock).mockImplementation((url: string) => {
            if (url.endsWith('.gpx')) return Promise.resolve({ ok: true, text: async () => '<gpx></gpx>' });
            return Promise.resolve({ ok: true, json: async () => ({ route: { name: 'My Loop' } }) });
        });

        const result = await fetchRouteGpx('token', 123);
        expect(result).toEqual({ gpx: '<gpx></gpx>', name: 'My Loop' });
    });
});

describe('deleteRwgpsRoute', () => {
    it('resolves on success', async () => {
        (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: true, status: 204 });
        await expect(deleteRwgpsRoute('token', 1)).resolves.toBeUndefined();
    });

    it('treats 404 as success (already gone)', async () => {
        (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: false, status: 404, statusText: 'Not Found' });
        await expect(deleteRwgpsRoute('token', 1)).resolves.toBeUndefined();
    });

    it('throws on other failures', async () => {
        (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: false, status: 500, statusText: 'Server Error' });
        await expect(deleteRwgpsRoute('token', 1)).rejects.toThrow('500');
    });
});

describe('buildLibraryTree', () => {
    const routes: RwgpsRouteSummary[] = [
        { id: 1, name: 'Loop A', distance: 1000, url: 'u1' },
        { id: 2, name: 'Loop B', distance: 2000, url: 'u2' },
        { id: 3, name: 'Solo Route', distance: 3000, url: 'u3' },
    ];

    it('buckets routes into their collections and leaves the rest uncategorized', () => {
        const tree = buildLibraryTree(routes, [
            { collection: { id: 10, name: 'Favorites' }, routeIds: [1, 2] },
        ]);
        expect(tree.collections).toEqual([
            { id: 10, name: 'Favorites', routes: [routes[0], routes[1]] },
        ]);
        expect(tree.uncategorized).toEqual([routes[2]]);
    });

    it('a route in multiple collections appears in each, and is not uncategorized', () => {
        const tree = buildLibraryTree(routes, [
            { collection: { id: 10, name: 'A' }, routeIds: [1] },
            { collection: { id: 11, name: 'B' }, routeIds: [1, 3] },
        ]);
        expect(tree.collections[0].routes).toEqual([routes[0]]);
        expect(tree.collections[1].routes).toEqual([routes[0], routes[2]]);
        expect(tree.uncategorized).toEqual([routes[1]]);
    });

    it('ignores a collection route id that no longer exists in the routes list', () => {
        const tree = buildLibraryTree(routes, [
            { collection: { id: 10, name: 'Stale' }, routeIds: [1, 999] },
        ]);
        expect(tree.collections[0].routes).toEqual([routes[0]]);
    });

    it('returns everything uncategorized when there are no collections', () => {
        const tree = buildLibraryTree(routes, []);
        expect(tree.collections).toEqual([]);
        expect(tree.uncategorized).toEqual(routes);
    });
});
