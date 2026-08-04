const RWGPS_BASE = 'https://ridewithgps.com';

export interface RwgpsUploadResult {
    routeId: number;
    routeUrl: string | null;
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
