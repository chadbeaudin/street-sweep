const RWGPS_BASE = 'https://ridewithgps.com';

export interface RwgpsUploadResult {
    routeId: number;
    routeUrl: string | null;
}

export interface RwgpsRouteSummary {
    id: number;
    name: string;
    distance: number; // meters
    url: string;
}

export interface RwgpsCollectionSummary {
    id: number;
    name: string | null;
}

function authHeaders(apiKey: string, accessToken: string): Record<string, string> {
    return {
        'x-rwgps-api-key': apiKey,
        'Authorization': `Bearer ${accessToken}`,
    };
}

function requireApiKey(): string {
    const apiKey = process.env.RWGPS_API_KEY?.trim();
    if (!apiKey) throw new Error('RWGPS_API_KEY not configured on server.');
    return apiKey;
}

function toRouteSummary(r: any): RwgpsRouteSummary {
    return { id: r.id, name: r.name, distance: r.distance, url: r.url };
}

function toCollectionSummary(c: any): RwgpsCollectionSummary {
    return { id: c.id, name: c.name };
}

// Routes list is paginated and a personal library can run into the hundreds —
// follow next_page_url until exhausted. Collections lists are small enough in
// practice (a personal folder count) that one large page covers it.
export async function listRoutes(accessToken: string): Promise<RwgpsRouteSummary[]> {
    const apiKey = requireApiKey();
    const routes: RwgpsRouteSummary[] = [];
    let url: string | null = `${RWGPS_BASE}/api/v1/routes.json?page=1&page_size=200`;
    while (url) {
        const res: Response = await fetch(url, { headers: authHeaders(apiKey, accessToken) });
        if (!res.ok) throw new Error(`RideWithGPS routes list failed: ${res.status} ${res.statusText}`);
        const data = await res.json();
        routes.push(...(data.routes ?? []).map(toRouteSummary));
        url = data.meta?.pagination?.next_page_url ?? null;
    }
    return routes;
}

export async function listCollections(accessToken: string): Promise<{ collection: RwgpsCollectionSummary; routeIds: number[] }[]> {
    const apiKey = requireApiKey();
    const res = await fetch(`${RWGPS_BASE}/api/v1/collections.json?page=1&page_size=200`, {
        headers: authHeaders(apiKey, accessToken),
    });
    if (!res.ok) throw new Error(`RideWithGPS collections list failed: ${res.status} ${res.statusText}`);
    const data = await res.json();
    const summaries: any[] = data.collections ?? [];

    // The list endpoint doesn't include member routes — fetch each collection's
    // detail to get its route ids. Small personal library, fine to do serially.
    const result: { collection: RwgpsCollectionSummary; routeIds: number[] }[] = [];
    for (const c of summaries) {
        const detailRes = await fetch(`${RWGPS_BASE}/api/v1/collections/${c.id}.json`, {
            headers: authHeaders(apiKey, accessToken),
        });
        if (!detailRes.ok) continue; // skip a collection we can't read rather than failing the whole tree
        const detail = await detailRes.json();
        const routeIds: number[] = (detail.collection?.routes ?? []).map((r: any) => r.id);
        result.push({ collection: toCollectionSummary(c), routeIds });
    }
    return result;
}

export async function fetchRouteGpx(accessToken: string, routeId: number): Promise<{ gpx: string; name: string }> {
    const apiKey = requireApiKey();
    const [gpxRes, detailRes] = await Promise.all([
        fetch(`${RWGPS_BASE}/api/v1/routes/${routeId}.gpx`, { headers: authHeaders(apiKey, accessToken) }),
        fetch(`${RWGPS_BASE}/api/v1/routes/${routeId}.json`, { headers: authHeaders(apiKey, accessToken) }),
    ]);
    if (!gpxRes.ok) throw new Error(`RideWithGPS route download failed: ${gpxRes.status} ${gpxRes.statusText}`);
    if (!detailRes.ok) throw new Error(`RideWithGPS route lookup failed: ${detailRes.status} ${detailRes.statusText}`);
    const gpx = await gpxRes.text();
    const detail = await detailRes.json();
    return { gpx, name: detail.route?.name ?? 'RideWithGPS Route' };
}

export interface RwgpsLibraryTree {
    collections: { id: number; name: string | null; routes: RwgpsRouteSummary[] }[];
    uncategorized: RwgpsRouteSummary[];
}

// Pure — split out from the route handler so it's directly unit-testable.
export function buildLibraryTree(
    allRoutes: RwgpsRouteSummary[],
    collections: { collection: RwgpsCollectionSummary; routeIds: number[] }[],
): RwgpsLibraryTree {
    const routesById = new Map(allRoutes.map(r => [r.id, r]));
    const categorized = new Set<number>();

    const tree = collections.map(({ collection, routeIds }) => {
        const routes = routeIds.map(id => routesById.get(id)).filter((r): r is RwgpsRouteSummary => !!r);
        routes.forEach(r => categorized.add(r.id));
        return { id: collection.id, name: collection.name, routes };
    });

    const uncategorized = allRoutes.filter(r => !categorized.has(r.id));
    return { collections: tree, uncategorized };
}

export async function deleteRwgpsRoute(accessToken: string, routeId: number): Promise<void> {
    const apiKey = requireApiKey();
    const res = await fetch(`${RWGPS_BASE}/api/v1/routes/${routeId}.json`, {
        method: 'DELETE',
        headers: authHeaders(apiKey, accessToken),
    });
    if (!res.ok && res.status !== 404) {
        throw new Error(`RideWithGPS route delete failed: ${res.status} ${res.statusText}`);
    }
}

async function pollTask(taskUrl: string, apiKey: string, accessToken: string): Promise<any> {
    const start = Date.now();
    while (Date.now() - start < 30000) {
        const res = await fetch(taskUrl, {
            headers: {
                'x-rwgps-api-key': apiKey,
                'Authorization': `Bearer ${accessToken}`,
            },
        });
        if (!res.ok) throw new Error(`RideWithGPS task poll failed: ${res.status} ${res.statusText}`);
        const data = await res.json();
        const task = data.task ?? data;
        if (task.status === 'completed') return task;
        await new Promise(r => setTimeout(r, 1000));
    }
    throw new Error('RideWithGPS upload timed out waiting for processing');
}

export async function uploadRouteToRwgps(accessToken: string, gpxContent: string, name: string): Promise<RwgpsUploadResult> {
    const apiKey = process.env.RWGPS_API_KEY?.trim();
    if (!apiKey) throw new Error('RWGPS_API_KEY not configured on server.');

    const form = new FormData();
    form.append('file', new Blob([gpxContent], { type: 'application/gpx+xml' }), `${name}.gpx`);
    form.append('name', name);

    const uploadRes = await fetch(`${RWGPS_BASE}/api/v1/routes.json`, {
        method: 'POST',
        headers: {
            'x-rwgps-api-key': apiKey,
            'Authorization': `Bearer ${accessToken}`,
        },
        body: form,
    });

    if (!uploadRes.ok) {
        const errorText = await uploadRes.text();
        throw new Error(`RideWithGPS upload failed: ${uploadRes.status} ${uploadRes.statusText} - ${errorText.substring(0, 300)}`);
    }

    const locationHeader = uploadRes.headers.get('Location');
    const taskUrl = locationHeader || (await uploadRes.json())?.task?.url;
    if (!taskUrl) throw new Error('RideWithGPS did not return a task URL to poll.');

    const task = await pollTask(taskUrl, apiKey, accessToken);

    if (task.errors?.length) {
        throw new Error(`RideWithGPS could not import the route: ${task.errors[0]?.code || 'unknown error'}`);
    }
    const item = task.items?.[0];
    if (!item?.item_id) throw new Error('RideWithGPS finished processing but returned no route.');

    return {
        routeId: item.item_id,
        routeUrl: `${RWGPS_BASE}/routes/${item.item_id}`,
    };
}
