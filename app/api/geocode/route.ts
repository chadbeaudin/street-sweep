import { withApiMetrics } from '@/lib/metrics';
import { withRateLimit } from '@/lib/rateLimit';
import { NextResponse } from 'next/server';
import { reverseAddress, searchAddresses } from '@/lib/nominatim';
import { z } from 'zod';
import { parseBody } from '@/lib/validation';

const Body = z.object({
    address: z.string().max(200).optional(),
    limit: z.number().int().min(1).max(10).optional(),
    lat: z.number().finite().min(-90).max(90).optional(),
    lon: z.number().finite().min(-180).max(180).optional(),
});

async function handlePOST(req: Request) {
    try {
        const parsed = await parseBody(req, Body);
        if ('error' in parsed) return parsed.error;
        const { address, limit, lat, lon } = parsed.data;
        if (lat !== undefined && lon !== undefined) {
            return NextResponse.json({ label: await reverseAddress(lat, lon) });
        }
        if (!address?.trim()) {
            return NextResponse.json({ error: 'address is required' }, { status: 400 });
        }
        const results = await searchAddresses(address, limit ?? 5);
        return NextResponse.json({ results });
    } catch (e: any) {
        return NextResponse.json({ error: e.message || 'Geocoding failed' }, { status: 500 });
    }
}

export const POST = withApiMetrics('POST', '/api/geocode', withRateLimit('geocode', handlePOST));
