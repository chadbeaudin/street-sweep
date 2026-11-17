import fs from 'fs';
import path from 'path';
import polyline from '@mapbox/polyline';
import { Client } from 'pg';
import { encryptToken } from '../lib/tokenCrypto';
import { haversineM } from '../lib/geometry';
import { E2E_ATHLETE_ID, E2E_SESSION_TOKEN } from './env';

const USER_ID = 'e2e-user';

interface FixtureWay { id: number; tags?: { name?: string }; geometry: { lat: number; lon: number }[] }

// Two "rides" along the longest fixture streets, so the ridden overlay lands on real roads.
export function fixtureRides(): { id: number; name: string; poly: [number, number][] }[] {
    const { elements } = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'osm.json'), 'utf8')) as { elements: FixtureWay[] };
    const length = (w: FixtureWay) => haversineM(w.geometry[0].lat, w.geometry[0].lon, w.geometry.at(-1)!.lat, w.geometry.at(-1)!.lon);
    return [...elements]
        .sort((a, b) => length(b) - length(a))
        .slice(0, 2)
        .map((w, i) => ({ id: 1000 + i, name: w.tags?.name ?? `E2E ride ${i + 1}`, poly: w.geometry.map(g => [g.lat, g.lon] as [number, number]) }));
}

export async function seed() {
    const rides = fixtureRides();
    // Rides older than the 14-day stream window and with detail rows already stored, so no Strava call is made.
    const activities = rides.map(r => ({
        id: r.id,
        name: r.name,
        map: { summary_polyline: polyline.encode(r.poly) },
        start_date: '2026-01-15T16:00:00Z',
        distance: 1000,
        total_elevation_gain: 10,
        moving_time: 300,
        type: 'Ride',
        sport_type: 'Ride',
    }));

    // Plain SQL: the generated Prisma client is ESM-only and won't load in Playwright's runner.
    const db = new Client({ connectionString: process.env.DATABASE_URL });
    await db.connect();
    try {
        await db.query('DELETE FROM users WHERE id = $1', [USER_ID]);
        await db.query('INSERT INTO users (id, name, "athleteId") VALUES ($1, $2, $3)', [USER_ID, 'E2E Rider', E2E_ATHLETE_ID]);
        await db.query(
            'INSERT INTO accounts (id, "userId", type, provider, "providerAccountId", refresh_token, scope) VALUES ($1, $2, $3, $4, $5, $6, $7)',
            ['e2e-account', USER_ID, 'oauth', 'strava', E2E_ATHLETE_ID, encryptToken('e2e-refresh-token'), 'read,activity:read'],
        );
        await db.query(
            'INSERT INTO sessions (id, "sessionToken", "userId", expires) VALUES ($1, $2, $3, $4)',
            ['e2e-session', E2E_SESSION_TOKEN, USER_ID, new Date(Date.now() + 24 * 60 * 60 * 1000)],
        );
        await db.query(
            `INSERT INTO strava_activity_cache ("athleteId", activities, "syncedAt") VALUES ($1, $2, now())
             ON CONFLICT ("athleteId") DO UPDATE SET activities = EXCLUDED.activities, "syncedAt" = now()`,
            [E2E_ATHLETE_ID, JSON.stringify(activities)],
        );
        for (const a of activities) {
            await db.query(
                `INSERT INTO strava_activity_detail ("activityId", "athleteId", polyline) VALUES ($1, $2, '')
                 ON CONFLICT ("activityId") DO UPDATE SET "athleteId" = EXCLUDED."athleteId", polyline = ''`,
                [String(a.id), E2E_ATHLETE_ID],
            );
        }
    } finally {
        await db.end();
    }
}
