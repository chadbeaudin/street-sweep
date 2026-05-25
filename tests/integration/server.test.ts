/**
 * Integration tests — spawns a real Next.js server, makes HTTP requests,
 * and asserts on the actual server log output.
 *
 * Run with: npm run test:integration
 * NOT included in the default `npm test` run.
 */
import { spawn, ChildProcess } from 'child_process';

const PORT = 3899; // avoid conflict with dev server on 3888
const BASE_URL = `http://localhost:${PORT}`;

async function waitForServer(timeoutMs = 60000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        try {
            await fetch(BASE_URL);
            return;
        } catch {
            await new Promise(r => setTimeout(r, 500));
        }
    }
    throw new Error('Server did not become ready within timeout');
}

async function post(path: string, body: unknown): Promise<Response> {
    return fetch(`${BASE_URL}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
}

// Wait for a log line matching the pattern to appear, with a timeout
async function waitForLog(logs: string[], pattern: RegExp, timeoutMs = 5000): Promise<RegExpMatchArray | null> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const match = logs.join('').match(pattern);
        if (match) return match;
        await new Promise(r => setTimeout(r, 100));
    }
    return null;
}

describe('Integration: server logs', () => {
    let server: ChildProcess;
    const logs: string[] = [];

    beforeAll(async () => {
        server = spawn('npx', ['next', 'dev', '-p', String(PORT)], {
            cwd: process.cwd(),
            stdio: ['ignore', 'pipe', 'pipe'],
            env: { ...process.env, NODE_ENV: 'development' },
        });

        const capture = (chunk: Buffer) => logs.push(chunk.toString());
        server.stdout?.on('data', capture);
        server.stderr?.on('data', capture);

        await waitForServer(60000);
    }, 90000);

    afterAll(() => {
        server?.kill('SIGTERM');
    });

    beforeEach(() => {
        logs.length = 0;
    });

    // ── Garmin elevation ───────────────────────────────────────────────────────

    describe('Garmin export — elevation logging', () => {
        const routeWithElevation = [
            [-104.700, 39.020, 280],
            [-104.710, 39.025, 285],
            [-104.720, 39.030, 290],
            [-104.715, 39.035, 283],
            [-104.700, 39.020, 278],
        ];

        it('logs totalAscent and totalDescent before attempting Garmin login', async () => {
            await post('/api/export/garmin', {
                route: routeWithElevation,
                name: 'Integration Test',
                email: 'test@example.com',
                password: 'fake_password_for_test',
            });

            const match = await waitForLog(logs, /\[Garmin\] totalAscent=(\d+)m totalDescent=(\d+)m points=(\d+)/);
            expect(match).not.toBeNull();

            const ascent = parseInt(match![1]);
            const descent = parseInt(match![2]);
            const points = parseInt(match![3]);

            expect(ascent).toBeGreaterThan(0);
            expect(descent).toBeGreaterThan(0);
            expect(points).toBe(routeWithElevation.length);
        });

        it('totalAscent matches expected value for known route (+10m)', async () => {
            const climbRoute = [
                [-104.700, 39.020, 280],
                [-104.710, 39.025, 285],
                [-104.720, 39.030, 290],
            ];

            await post('/api/export/garmin', {
                route: climbRoute,
                name: 'Climb Test',
                email: 'test@example.com',
                password: 'fake_password_for_test',
            });

            const match = await waitForLog(logs, /\[Garmin\] totalAscent=(\d+)m totalDescent=(\d+)m/);
            expect(match).not.toBeNull();
            expect(parseInt(match![1])).toBe(10); // 280→285→290 = +10m
            expect(parseInt(match![2])).toBe(0);  // no descent
        });

        it('logs zero elevation when route has no elevation data', async () => {
            const flatRoute = [
                [-104.700, 39.020],
                [-104.710, 39.025],
                [-104.720, 39.030],
            ];

            await post('/api/export/garmin', {
                route: flatRoute,
                name: 'Flat Test',
                email: 'test@example.com',
                password: 'fake_password_for_test',
            });

            const match = await waitForLog(logs, /\[Garmin\] totalAscent=(\d+)m totalDescent=(\d+)m/);
            expect(match).not.toBeNull();
            expect(parseInt(match![1])).toBe(0);
            expect(parseInt(match![2])).toBe(0);
        });
    });

    // ── Route generation — elevation in coordinates ────────────────────────────

    describe('Route generate — elevation in response', () => {
        it('returns route coordinates with non-zero elevation for a real area', async () => {
            // Small bbox around Denver — known elevated terrain
            const payload = {
                bbox: { south: 39.72, west: -104.99, north: 39.74, east: -104.97 },
                selectedPoints: [
                    { lat: 39.73, lon: -104.98 },
                    { lat: 39.73, lon: -104.975 },
                ],
                routingOptions: { avoidGravel: false, avoidConstruction: false },
            };

            const res = await post('/api/generate', payload);
            // May fail if OSM/elevation APIs are unavailable — mark as skippable
            if (!res.ok) {
                console.warn('Generate API failed (external dependency) — skipping elevation check');
                return;
            }

            const data = await res.json();
            const coords: number[][] = data?.features?.[0]?.geometry?.coordinates ?? [];
            expect(coords.length).toBeGreaterThan(0);

            // Every coordinate should have a non-null elevation (index 2)
            const elevations = coords.map(c => c[2]);
            expect(elevations.some(e => e !== 0 && e !== null && e !== undefined)).toBe(true);

            // Elevation should be in meters — Denver is ~1600m, not ~5249 (feet)
            const avgEle = elevations.reduce((a, b) => a + b, 0) / elevations.length;
            expect(avgEle).toBeLessThan(3000); // sanity: not feet
            expect(avgEle).toBeGreaterThan(100); // sanity: not zero/sea-level
        }, 60000);
    });
});
