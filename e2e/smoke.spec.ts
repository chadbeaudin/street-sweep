import fs from 'fs';
import { test, expect } from '@playwright/test';
import { haversineM } from '../lib/geometry';
import { E2E_BASE_URL, E2E_ENV, E2E_LIVE, E2E_MAP_CENTER, E2E_SESSION_TOKEN } from './env';

// Covers both clicks (about 500 m either side of the centre) plus room for the route to wander.
const MAX_ROUTE_RADIUS_M = 1500;

// The app falls back to public Overpass mirrors and Open-Meteo, which would hide a down NAS, so probe them directly.
test('the live street and elevation services answer', async ({ request }) => {
    test.skip(!E2E_LIVE, 'live run only');
    const { latitude, longitude } = E2E_MAP_CENTER;
    const overpass = await request.post(E2E_ENV.OVERPASS_URL, {
        form: { data: `[out:json][timeout:25];way["highway"](around:200,${latitude},${longitude});out ids;` },
    });
    expect(overpass.status()).toBe(200);
    expect((await overpass.json()).elements.length).toBeGreaterThan(0);

    const elevation = await request.get(`${E2E_ENV.OPEN_TOPO_URL}/v1/copernicus90?locations=${latitude},${longitude}`);
    expect(elevation.status()).toBe(200);
    expect((await elevation.json()).results[0].elevation).toBeGreaterThan(0);
});

test('a signed-in rider sees their rides, routes between two points and exports a GPX', async ({ page, context }) => {
    // Map tiles and anything else off-box are dropped so the run never depends on the network.
    await context.route(url => url.hostname !== 'localhost', route => route.abort());
    await context.addCookies([{ name: 'next-auth.session-token', value: E2E_SESSION_TOKEN, url: E2E_BASE_URL }]);
    await page.addInitScript(() => localStorage.setItem('streetsweep_seen_tutorial', '1'));

    const ridesResponse = page.waitForResponse(r => r.url().endsWith('/api/strava/activities'));
    await page.goto('/');
    await expect(page.getByRole('button', { name: 'E2E Rider' })).toBeVisible();
    const rides = await ridesResponse;
    expect(rides.status()).toBe(200);
    expect((await rides.json()).riddenRoads).toHaveLength(2);

    await page.getByRole('button', { name: 'Cycling' }).click();
    await page.getByRole('button', { name: 'Zoom in' }).click();
    await page.getByRole('button', { name: 'Zoom in' }).click();

    // Two clicks either side of the map centre, which geolocation puts inside the fixture area.
    const box = (await page.locator('.leaflet-container').boundingBox())!;
    const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
    const generated = page.waitForResponse(r => r.url().endsWith('/api/generate'));
    await page.mouse.click(cx - 150, cy);
    await page.mouse.click(cx + 150, cy);
    expect((await generated).status()).toBe(200);

    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'GPX' }).click();
    const gpx = fs.readFileSync(await (await download).path(), 'utf8');
    const points = [...gpx.matchAll(/<trkpt lat="([-\d.]+)" lon="([-\d.]+)"/g)].map(m => ({ lat: Number(m[1]), lon: Number(m[2]) }));
    expect(points.length).toBeGreaterThan(10);
    for (const p of points) {
        expect(haversineM(p.lat, p.lon, E2E_MAP_CENTER.latitude, E2E_MAP_CENTER.longitude)).toBeLessThan(MAX_ROUTE_RADIUS_M);
    }
});
