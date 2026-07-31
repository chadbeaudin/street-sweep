import { PrismaClient } from './generated/prisma/client';
import { PrismaNeonHttp } from '@prisma/adapter-neon';

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };

function createClient() {
    // keepalive:false forces a fresh HTTP connection per query. The long-lived
    // dev-server client otherwise reuses a pooled Neon socket that goes stale
    // after idle, surfacing as intermittent `TypeError: fetch failed`.
    const adapter = new PrismaNeonHttp(process.env.DATABASE_URL!, { fetchOptions: { keepalive: false } });
    return new PrismaClient({ adapter });
}

export const prisma = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;
