export const E2E_PORT = 3897;
export const E2E_STUB_PORT = 3898;
export const E2E_BASE_URL = `http://localhost:${E2E_PORT}`;
export const E2E_SESSION_TOKEN = 'e2e-session-token';
export const E2E_ATHLETE_ID = '990001';
// Inside the fixture area (e2e/fixtures/osm.json).
export const E2E_MAP_CENTER = { latitude: 47.655, longitude: -117.385 };
// E2E_LIVE=1 swaps the stub for the real Overpass (OVERPASS_URL) and elevation (OPEN_TOPO_URL) services (#247).
export const E2E_LIVE = process.env.E2E_LIVE === '1';
export const E2E_OSM_CACHE_DIR = E2E_LIVE ? '.cache/e2e-live-osm' : '.cache/e2e-osm';

function liveUrl(name: string): string {
    const url = process.env[name];
    if (!url) throw new Error(`E2E_LIVE=1 needs ${name}`);
    return url;
}

// Test-only values: a throwaway encryption key and fake Strava app, so nothing here can reach a real account.
export const E2E_ENV: Record<string, string> = {
    // Locally, point E2E_DATABASE_URL at a scratch Postgres with the schema pushed; the seed rewrites its rows.
    DATABASE_URL: process.env.E2E_DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/streetsweep_e2e',
    NEXTAUTH_URL: E2E_BASE_URL,
    NEXTAUTH_SECRET: 'e2e-nextauth-secret',
    ACCOUNT_TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
    STRAVA_CLIENT_ID: 'e2e',
    STRAVA_CLIENT_SECRET: 'e2e',
    STRAVA_REFRESH_TOKEN: '',
    OVERPASS_URL: E2E_LIVE ? liveUrl('OVERPASS_URL') : `http://localhost:${E2E_STUB_PORT}/api/interpreter`,
    OPEN_TOPO_URL: E2E_LIVE ? liveUrl('OPEN_TOPO_URL') : `http://localhost:${E2E_STUB_PORT}`,
    E2E_STUB_PORT: String(E2E_STUB_PORT),
    OSM_CACHE_DIR: E2E_OSM_CACHE_DIR,
    NEXT_DIST_DIR: '.next-e2e',
};
