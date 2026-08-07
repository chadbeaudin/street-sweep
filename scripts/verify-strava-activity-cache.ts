// Standalone verification of the StravaActivityCache round-trip, independent of
// the Strava API entirely — proves the Postgres JSON serialize/deserialize cycle
// works for this exact data shape, without needing the rate limit to clear.
// Throwaway script — not part of the app build. Run with: npx tsx scripts/verify-strava-activity-cache.ts
import { config } from 'dotenv';
config({ path: '.env.local' });
config();

import { prisma } from '../lib/prisma';
import type { StravaActivity } from '../lib/strava';

const TEST_ATHLETE_ID = '__test_athlete_verification__';

const fakeActivities: StravaActivity[] = [
    {
        id: 111111,
        name: 'Test Ride A',
        map: { summary_polyline: 'a}~vHtwwe@sB{Ac@a@]KMs@' },
        start_date: '2026-08-01T12:00:00Z',
        distance: 12345.6,
        total_elevation_gain: 210.5,
        type: 'Ride',
        sport_type: 'Ride',
    },
    {
        id: 222222,
        name: 'Test Ride B — special chars "quotes" & <tags>',
        map: { summary_polyline: '_p~iF~ps|U_ulLnnqC_mqNvxq`@' },
        start_date: '2026-08-02T09:30:00Z',
        distance: 54321.0,
        total_elevation_gain: 0,
        type: 'Ride',
        sport_type: 'GravelRide',
    },
];

async function main() {
    console.log('1. Cleaning up any prior test row...');
    await prisma.stravaActivityCache.deleteMany({ where: { athleteId: TEST_ATHLETE_ID } });

    console.log('2. Upserting fake activity data...');
    await prisma.stravaActivityCache.upsert({
        where: { athleteId: TEST_ATHLETE_ID },
        create: { athleteId: TEST_ATHLETE_ID, activities: fakeActivities as any, syncedAt: new Date() },
        update: { activities: fakeActivities as any, syncedAt: new Date() },
    });

    console.log('3. Reading it back...');
    const row = await prisma.stravaActivityCache.findUnique({ where: { athleteId: TEST_ATHLETE_ID } });
    if (!row) throw new Error('FAIL: row not found after upsert');

    const roundTripped = row.activities as unknown as StravaActivity[];
    // Postgres JSONB doesn't preserve key insertion order, so compare with keys
    // sorted rather than raw JSON.stringify (order-sensitive, order doesn't matter
    // to real code that accesses fields by name).
    const sortKeysDeep = (v: any): any => Array.isArray(v) ? v.map(sortKeysDeep) : (v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, sortKeysDeep(v[k])])) : v);
    const matches = JSON.stringify(sortKeysDeep(roundTripped)) === JSON.stringify(sortKeysDeep(fakeActivities));
    console.log(`   Round-trip exact match: ${matches}`);
    if (!matches) {
        console.log('   Expected:', JSON.stringify(fakeActivities, null, 2));
        console.log('   Got:     ', JSON.stringify(roundTripped, null, 2));
        throw new Error('FAIL: round-tripped data does not match');
    }

    console.log('4. Verifying TTL freshness check logic...');
    const ageMs = Date.now() - row.syncedAt.getTime();
    const TTL = 24 * 60 * 60 * 1000;
    console.log(`   Age: ${ageMs}ms, fresh (< ${TTL}ms): ${ageMs < TTL}`);
    if (ageMs >= TTL || ageMs < 0) throw new Error('FAIL: freshly-written row does not read back as fresh');

    console.log('5. Testing upsert (update path) with changed data...');
    const updated = [...fakeActivities, { ...fakeActivities[0], id: 333333, name: 'Test Ride C' }];
    await prisma.stravaActivityCache.upsert({
        where: { athleteId: TEST_ATHLETE_ID },
        create: { athleteId: TEST_ATHLETE_ID, activities: updated as any, syncedAt: new Date() },
        update: { activities: updated as any, syncedAt: new Date() },
    });
    const row2 = await prisma.stravaActivityCache.findUnique({ where: { athleteId: TEST_ATHLETE_ID } });
    const count = (row2!.activities as unknown as StravaActivity[]).length;
    console.log(`   Activity count after update: ${count} (expected 3)`);
    if (count !== 3) throw new Error('FAIL: update path did not overwrite correctly');

    console.log('6. Cleaning up test row...');
    await prisma.stravaActivityCache.deleteMany({ where: { athleteId: TEST_ATHLETE_ID } });

    console.log('\n✅ ALL CHECKS PASSED — StravaActivityCache round-trip verified against real Postgres.');
    await prisma.$disconnect();
}

main().catch(async (e) => {
    console.error('\n❌ VERIFICATION FAILED:', e);
    await prisma.$disconnect();
    process.exit(1);
});
