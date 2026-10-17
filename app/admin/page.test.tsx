jest.mock('next-auth', () => ({ getServerSession: jest.fn() }));
jest.mock('@/lib/auth', () => ({ authOptions: {} }));
jest.mock('next/navigation', () => ({ notFound: jest.fn() }));
jest.mock('@/lib/adminStats', () => ({ ...jest.requireActual('@/lib/adminStats'), getAdminStats: jest.fn() }));
jest.mock('@/lib/prisma', () => ({ prisma: {} }));

import { renderToStaticMarkup } from 'react-dom/server';
import { getServerSession } from 'next-auth';
import { getAdminStats } from '@/lib/adminStats';
import { notFound } from 'next/navigation';
import AdminPage from './page';

const ORIGINAL_ENV = process.env;
beforeEach(() => {
    process.env = { ...ORIGINAL_ENV, ADMIN_ATHLETE_IDS: '42' };
    (notFound as unknown as jest.Mock).mockImplementation(() => { throw new Error('NEXT_NOT_FOUND'); });
});
afterAll(() => { process.env = ORIGINAL_ENV; });

const stats = {
    users: { total: 12, stravaLinked: 10, withHistory: 9, creditOn: 8, new: { day: 1, week: 2, month: 3 }, active: { day: 4, week: 6, month: 11 } },
    exportedRoutes: { total: 30, month: 5 },
    queues: { riddenRoads: { queued: 1, running: 1, failed: 2 }, stravaSync: { pending: 3, retrying: 1, oldestAgeMs: 120_000 } },
    api: [{ route: 'POST /api/generate', requests: 50, clientErrors: 1, serverErrors: 2, avgMs: 1500, p50Ms: 1000, p95Ms: 5000 }],
};

describe('/admin (#117)', () => {
    it('is a 404 for anyone not on the admin list, without loading any stats', async () => {
        (getServerSession as jest.Mock).mockResolvedValue({ user: { athleteId: '7' } });
        await expect(AdminPage()).rejects.toThrow('NEXT_NOT_FOUND');
        (getServerSession as jest.Mock).mockResolvedValue(null);
        await expect(AdminPage()).rejects.toThrow('NEXT_NOT_FOUND');
        expect(getAdminStats).not.toHaveBeenCalled();
    });

    it('renders user, background-work and API figures for an admin', async () => {
        (getServerSession as jest.Mock).mockResolvedValue({ user: { athleteId: '42' } });
        (getAdminStats as jest.Mock).mockResolvedValue(stats);
        const html = renderToStaticMarkup(await AdminPage());
        expect(html).toContain('Total users');
        expect(html).toContain('+1 today · +2 this week · +3 in 30d');
        expect(html).toContain('oldest 2m');
        expect(html).toContain('POST /api/generate');
        expect(html).toContain('1.5s');
        expect(html).toContain('fly.io/apps/streetsweep/monitoring');
    });
});
