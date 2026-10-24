import { withApiMetrics } from '@/lib/metrics';
import { NextResponse } from 'next/server';
import { checkServices } from '@/lib/serviceHealth';

export const dynamic = 'force-dynamic';

async function handleGET() {
    const services = await checkServices();
    return NextResponse.json({ services }, { headers: { 'Cache-Control': 'no-store' } });
}

export const GET = withApiMetrics('GET', '/api/health', handleGET);
