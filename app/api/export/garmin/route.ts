import { NextResponse } from 'next/server';
import { GarminConnect } from 'garmin-connect';
import { buildFitCourse } from '@/lib/fit';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export async function POST(req: Request) {
    let tempFile: string | null = null;
    try {
        const { route, name, email, password } = await req.json();

        if (!route || !email || !password) {
            return NextResponse.json({ error: 'Missing required data' }, { status: 400 });
        }

        // Build FIT course file in memory — includes totalAscent/totalDescent in lap
        const fitBytes = buildFitCourse(route, name || 'StreetSweep Course');

        // garmin-connect's uploadActivity requires a file path, so write to tmp
        tempFile = path.join(os.tmpdir(), `streetsweep-${Date.now()}.fit`);
        fs.writeFileSync(tempFile, Buffer.from(fitBytes));

        const GCClient = new GarminConnect({ username: email, password });
        await GCClient.login();

        // Upload as FIT — Garmin recognises file_id.type=6 as a Course
        const response = await GCClient.uploadActivity(tempFile, 'fit');
        console.log('[Garmin] Upload response:', JSON.stringify(response));

        return NextResponse.json({
            success: true,
            message: 'Course uploaded successfully to your Garmin account!',
            details: response
        });

    } catch (err: any) {
        console.error('Garmin upload error:', err.message);
        let errorMessage = err.message || 'Failed to upload course to Garmin.';
        if (err.response?.data) {
            errorMessage = `Garmin API Error: ${JSON.stringify(err.response.data)}`;
        }
        return NextResponse.json({ error: errorMessage }, { status: 500 });
    } finally {
        if (tempFile) {
            try { fs.unlinkSync(tempFile); } catch { /* ignore */ }
        }
    }
}
