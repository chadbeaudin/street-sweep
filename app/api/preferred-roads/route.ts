import { prisma } from '@/lib/prisma';
import { markedRoadsRoute } from '@/lib/markedRoadsRoute';

export const { GET, PUT } = markedRoadsRoute('/api/preferred-roads', {
    find: userId => prisma.preferredRoads.findUnique({ where: { userId } }),
    save: (userId, roads) => prisma.preferredRoads.upsert({ where: { userId }, create: { userId, roads }, update: { roads } }),
});
