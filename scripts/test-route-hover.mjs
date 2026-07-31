// Reproduce map-route hover -> elevation profile highlight in a real browser.
import { chromium } from 'playwright';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
page.on('console', msg => {
  const t = msg.text();
  if (!t.includes('Download the React DevTools')) console.log('[browser]', t.slice(0, 200));
});
page.on('pageerror', err => console.log('[pageerror]', err.message));

// Dummy Strava creds so the forced About dialog stays closed
await page.addInitScript(() => {
  localStorage.setItem('strava_settings', JSON.stringify({ clientId: 'x', clientSecret: 'x', refreshToken: 'x' }));
});
await page.goto('http://localhost:3888', { waitUntil: 'networkidle' });
await sleep(3000);
const aboutVisible = await page.locator('text=About StreetSweep').isVisible().catch(() => false);
console.log('about dialog visible:', aboutVisible);

// Close the Strava token error dialog from the dummy creds
const closeError = page.locator('button:has-text("Close")').first();
if (await closeError.isVisible().catch(() => false)) {
  await closeError.click();
  console.log('closed error dialog');
}
await sleep(500);

// Click two points on roads near map center to build a route (point mode default)
const map = page.locator('.leaflet-container');
const box = await map.boundingBox();
const cx = box.x + box.width / 2;
const cy = box.y + box.height / 2;

await page.mouse.click(cx - 60, cy);
await sleep(1500);
await page.mouse.click(cx + 60, cy);
console.log('clicked two points, waiting for route generation...');
let profileVisible = false;
for (let i = 0; i < 30; i++) {
  await sleep(2000);
  profileVisible = await page.locator('text=Elevation Profile').isVisible().catch(() => false);
  if (profileVisible) break;
}
console.log('elevation profile visible:', profileVisible);

// Find the rendered route polyline (red, weight 5) and hover over it
const routeInfo = await page.evaluate(() => {
  const paths = Array.from(document.querySelectorAll('.leaflet-overlay-pane path'));
  const route = paths.filter(p => p.getAttribute('stroke') === '#EF4444' && p.getAttribute('stroke-width') === '5');
  return route.map(p => {
    const len = p.getTotalLength();
    const mid = p.getPointAtLength(len / 2);
    const pt = p.ownerSVGElement.createSVGPoint();
    pt.x = mid.x;
    pt.y = mid.y;
    const screen = pt.matrixTransform(p.getScreenCTM());
    return { mid: { x: screen.x, y: screen.y } };
  });
});
console.log('route paths found:', routeInfo.length);
if (routeInfo.length === 0) {
  await page.screenshot({ path: '/tmp/hover-test-noroute.png' });
  console.log('no route — screenshot at /tmp/hover-test-noroute.png');
  await browser.close();
  process.exit(1);
}

const target = routeInfo[0];
const hx = target.mid.x;
const hy = target.mid.y;
console.log(`hovering route at page coords (${hx.toFixed(0)}, ${hy.toFixed(0)})`);
await page.mouse.move(hx, hy, { steps: 5 });
await sleep(1000);

// Check for the amber ReferenceDot in the recharts SVG
const dot = await page.evaluate(() => {
  const refGroups = document.querySelectorAll('.recharts-reference-dot').length;
  const circles = Array.from(document.querySelectorAll('circle'));
  const amber = circles.filter(c => (c.getAttribute('fill') || '').toUpperCase() === '#F59E0B');
  return { refGroups, amber: amber.map(c => ({ cx: c.getAttribute('cx'), cy: c.getAttribute('cy') })) };
});
console.log('reference-dot groups:', dot.refGroups, 'amber dots:', JSON.stringify(dot.amber));

// Reverse direction: hover the elevation profile chart, expect HoverMarker on map
const chart = await page.locator('.recharts-wrapper').boundingBox();
await page.mouse.move(chart.x + chart.width * 0.4, chart.y + chart.height / 2, { steps: 3 });
await sleep(800);
const mapMarker = await page.evaluate(() => document.querySelectorAll('.custom-hover-icon').length);
console.log('profile->map hover marker on map:', mapMarker);

await page.screenshot({ path: '/tmp/hover-test.png' });
console.log('screenshot: /tmp/hover-test.png');
await browser.close();
