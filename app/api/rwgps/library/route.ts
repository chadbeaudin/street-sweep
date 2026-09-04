import { NextResponse } from 'next/server';
import { listRoutes, listCollections, buildLibraryTree } from '@/lib/rwgps';

export async function POST(req: Request) {
    try {
        const { accessToken } = await req.json();
        if (!accessToken) {
            return NextResponse.json({ error: 'Missing accessToken' }, { status: 400 });
        }

        const [routes, collections] = await Promise.all([
            listRoutes(accessToken),
            listCollections(accessToken),
        ]);

        return NextResponse.json(buildLibraryTree(routes, collections));
    } catch (error: any) {
        console.error('RideWithGPS library fetch error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
