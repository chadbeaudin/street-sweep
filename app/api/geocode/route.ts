import { NextResponse } from 'next/server';
import { geocodeAddress } from '@/lib/nominatim';

export async function POST(req: Request) {
    try {
        const { address } = await req.json() as { address?: string };
        if (!address || typeof address !== 'string' || !address.trim()) {
            return NextResponse.json({ error: 'address is required' }, { status: 400 });
        }
        const result = await geocodeAddress(address);
        if (!result) {
            return NextResponse.json({ error: 'Address not found' }, { status: 404 });
        }
        return NextResponse.json(result);
    } catch (e: any) {
        return NextResponse.json({ error: e.message || 'Geocoding failed' }, { status: 500 });
    }
}
