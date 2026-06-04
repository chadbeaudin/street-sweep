import { PrismaClient } from './generated/prisma/client';
import { PrismaNeonHttp } from '@prisma/adapter-neon';

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };

function createClient() {
    const adapter = new PrismaNeonHttp(process.env.DATABASE_URL!, {});
    return new PrismaClient({ adapter });
}

export const prisma = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;
