import { prisma } from '@/lib/prisma';
import { markedRoadsRoute } from '@/lib/markedRoadsRoute';

export const { GET, PUT } = markedRoadsRoute('/api/avoided-roads', {
    find: userId => prisma.avoidedRoads.findUnique({ where: { userId } }),
    save: (userId, roads) => prisma.avoidedRoads.upsert({ where: { userId }, create: { userId, roads }, update: { roads } }),
});
