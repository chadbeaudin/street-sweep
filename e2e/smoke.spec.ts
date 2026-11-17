import fs from 'fs';
import { test, expect } from '@playwright/test';
import { E2E_BASE_URL, E2E_SESSION_TOKEN } from './env';

// The fixture area's bounds (e2e/fixtures/osm.json).
const FIXTURE_BOUNDS = { south: 47.65, west: -117.4, north: 47.66, east: -117.37 };

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
        expect(p.lat).toBeGreaterThanOrEqual(FIXTURE_BOUNDS.south);
        expect(p.lat).toBeLessThanOrEqual(FIXTURE_BOUNDS.north);
        expect(p.lon).toBeGreaterThanOrEqual(FIXTURE_BOUNDS.west);
        expect(p.lon).toBeLessThanOrEqual(FIXTURE_BOUNDS.east);
    }
});
