import { withApiMetrics } from '@/lib/metrics';
import { NextResponse } from 'next/server';
import { reverseAddress, searchAddresses } from '@/lib/nominatim';

async function handlePOST(req: Request) {
    try {
        const { address, limit, lat, lon } = await req.json() as { address?: string; limit?: number; lat?: number; lon?: number };
        if (typeof lat === 'number' && typeof lon === 'number') {
            return NextResponse.json({ label: await reverseAddress(lat, lon) });
        }
        if (!address || typeof address !== 'string' || !address.trim()) {
            return NextResponse.json({ error: 'address is required' }, { status: 400 });
        }
        const results = await searchAddresses(address, limit ?? 5);
        return NextResponse.json({ results });
    } catch (e: any) {
        return NextResponse.json({ error: e.message || 'Geocoding failed' }, { status: 500 });
    }
}

export const POST = withApiMetrics('POST', '/api/geocode', handlePOST);
