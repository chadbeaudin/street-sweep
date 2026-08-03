import { NextResponse } from 'next/server';
import { searchAddresses } from '@/lib/nominatim';

export async function POST(req: Request) {
    try {
        const { address, limit } = await req.json() as { address?: string; limit?: number };
        if (!address || typeof address !== 'string' || !address.trim()) {
            return NextResponse.json({ error: 'address is required' }, { status: 400 });
        }
        const results = await searchAddresses(address, limit ?? 5);
        return NextResponse.json({ results });
    } catch (e: any) {
        return NextResponse.json({ error: e.message || 'Geocoding failed' }, { status: 500 });
    }
}
