jest.mock('next-auth', () => ({ getServerSession: jest.fn() }));
jest.mock('@/lib/auth', () => ({ authOptions: {} }));
jest.mock('next/navigation', () => ({ notFound: jest.fn() }));
jest.mock('@/lib/adminStats', () => ({ ...jest.requireActual('@/lib/adminStats'), getAdminStats: jest.fn() }));
jest.mock('@/lib/prisma', () => ({ prisma: { user: { findUnique: jest.fn() } } }));

import { renderToStaticMarkup } from 'react-dom/server';
import { getServerSession } from 'next-auth';
import { getAdminStats } from '@/lib/adminStats';
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import AdminPage from './page';

beforeEach(() => {
    (prisma.user.findUnique as jest.Mock).mockImplementation(async ({ where }: { where: { id: string } }) => ({ isAdmin: where.id === 'admin' }));
    (notFound as unknown as jest.Mock).mockImplementation(() => { throw new Error('NEXT_NOT_FOUND'); });
});

const stats = {
    users: { total: 12, stravaLinked: 10, withHistory: 9, creditOn: 8, new: { day: 1, week: 2, month: 3 }, active: { day: 4, week: 6, month: 11 } },
    exportedRoutes: { total: 30, month: 5 },
    queues: { riddenRoads: { queued: 1, running: 1, failed: 2 }, stravaSync: { pending: 3, retrying: 1, oldestAgeMs: 120_000 } },
    api: [{ route: 'POST /api/generate', requests: 50, clientErrors: 1, serverErrors: 2, avgMs: 1500, p50Ms: 1000, p95Ms: 5000 }],
    usage: {
        routes: { point: 6, area: 2, mixed: 1 }, exports: { gpx: 3, garmin: 1 }, imports: { fit: 1 }, stravaSyncs: { incremental: 6, full: 1 }, statsOpens: 4,
        regions: [{ lat: 47, lon: -118, count: 7 }],
    },
    observability: {
        routing: {
            solve: { runs: 4, avgMs: 500, p50Ms: 250, p95Ms: 1000 },
            sizes: [{ bound: '5', count: 3 }, { bound: '10', count: 0 }, { bound: '25', count: 0 }, { bound: '50', count: 0 }, { bound: 'inf', count: 1 }],
            tooLarge: { area: 2 },
        },
        services: [{ service: 'overpass', requests: 10, errors: 2, rateLimited: 0, breaker: 1 }],
        caches: [{ cache: 'osm', hits: { memory: 6, disk: 2 }, misses: 2, hitRate: 0.8 }],
        workers: [{ job: 'ridden_roads', runs: 2, avgMs: 45_000, p50Ms: 60_000, p95Ms: 60_000, failed: 1 }],
        rateLimited: { geocode: 5 },
    },
    failures: {
        userErrors: [{ kind: 'step', day: 2, month: 5 }],
        accountHealth: { strava_token_rejected: 4, deleted: 1 },
        lostWork: { syncGivenUp: 2, syncNoCredentials: 0, enqueueFailed: 0, tilesFailed: 7, webhook: { rejected: 3, ignored: 1 } },
        memory: [{ process: 'worker', samples: 60, avgPct: 62.4, peak: 'over' }],
    },
};

describe('/admin (#117)', () => {
    it('is a 404 for anyone not flagged admin in the DB, without loading any stats', async () => {
        (getServerSession as jest.Mock).mockResolvedValue({ user: { id: 'someone' } });
        await expect(AdminPage()).rejects.toThrow('NEXT_NOT_FOUND');
        (getServerSession as jest.Mock).mockResolvedValue(null);
        await expect(AdminPage()).rejects.toThrow('NEXT_NOT_FOUND');
        expect(getAdminStats).not.toHaveBeenCalled();
    });

    it('renders user, background-work and API figures for an admin', async () => {
        (getServerSession as jest.Mock).mockResolvedValue({ user: { id: 'admin' } });
        (getAdminStats as jest.Mock).mockResolvedValue(stats);
        const html = renderToStaticMarkup(await AdminPage());
        expect(html).toContain('Total users');
        expect(html).toMatch(/<a [^>]*href="\/"[^>]*>← Back to StreetSweep/);
        expect(html).toContain('+1 today · +2 this week · +3 in 30d');
        expect(html).toContain('oldest 2m');
        expect(html).toContain('POST /api/generate');
        expect(html).toContain('6 point · 2 area · 1 mixed');
        expect(html).toContain('3 gpx · 1 garmin');
        expect(html).toContain('6 incremental · 1 full');
        expect(html).toContain('47°N 118°W');
        expect(html).toContain('href="https://www.openstreetmap.org/#map=8/47.5/-117.5"');
        expect(html).toContain('avg 500ms · p50 250ms · p95 1.0s');
        expect(html).toContain('&lt;5 mi: 3 · 5–10: 0 · 10–25: 0 · 25–50: 0 · 50+: 1');
        expect(html).toMatch(/overpass<\/td><td[^>]*>10<\/td><td[^>]*><span[^>]*>2<\/span>/);
        expect(html).toContain('80%');
        expect(html).toContain('6 memory · 2 disk');
        expect(html).toContain('Rate limited (429): 5 geocode');
        expect(html).toMatch(/step<\/td><td[^>]*><span class="text-red-600 font-semibold">2<\/span><\/td><td[^>]*>5</);
        expect(html).toMatch(/Strava tokens rejected<\/div><div[^>]*>4</);
        expect(html).toMatch(/Accounts deleted<\/div><div[^>]*>1</);
        expect(html).toMatch(/Strava syncs given up<\/div><div[^>]*>2</);
        expect(html).toContain('1 ignored · 0 unconfirmed revokes');
        expect(html).toMatch(/worker<\/td><td[^>]*>60<\/td><td[^>]*>62%<\/td><td[^>]*><span class="text-red-600 font-semibold">&gt;90%/);
        expect(html).toContain('1.5s');
        expect(html).toContain('fly.io/apps/streetsweep/monitoring');
    });
});
