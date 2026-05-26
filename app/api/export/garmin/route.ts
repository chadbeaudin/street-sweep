import { NextResponse } from 'next/server';
import { GarminConnect } from 'garmin-connect';
import { haversineM } from '@/lib/geometry';

export async function POST(req: Request) {
    try {
        const { route, name, email, password } = await req.json();

        if (!route || !email || !password) {
            return NextResponse.json({ error: 'Missing required data' }, { status: 400 });
        }

        const GCClient = new GarminConnect({ username: email, password });
        await GCClient.login();

        let totalDist = 0;
        let totalTime = 0;
        let totalAscent = 0;
        let totalDescent = 0;
        const MOCK_SPEED = 5;

        const geoPoints = route.map((pt: any, i: number) => {
            if (i > 0) {
                const p1 = route[i - 1];
                const d = haversineM(p1[1], p1[0], pt[1], pt[0]);
                totalDist += d;
                totalTime += Math.max(1, Math.round(d / MOCK_SPEED));
                const eleDiff = (pt[2] ?? 0) - (p1[2] ?? 0);
                if (eleDiff > 0) totalAscent += eleDiff;
                else totalDescent += -eleDiff;
            }
            return {
                latitude: pt[1],
                longitude: pt[0],
                elevation: pt[2] ?? 0,
                distance: totalDist,
                time: totalTime
            };
        });

        const coursePayload = {
            courseName: name || 'StreetSweep Route',
            activityTypePk: 2,
            rulePK: 2,
            sourceTypeId: 2,
            totalAscent: Math.round(totalAscent),
            totalDescent: Math.round(totalDescent),
            startPoint: {
                latitude: route[0][1],
                longitude: route[0][0]
            },
            geoPoints
        };

        console.log(`[Garmin] totalAscent=${Math.round(totalAscent)}m totalDescent=${Math.round(totalDescent)}m points=${route.length}`);

        const url = 'https://connectapi.garmin.com/course-service/course';
        // @ts-ignore
        const createRes = await GCClient.client.post(url, coursePayload, {
            headers: { 'Content-Type': 'application/json', 'NK': 'NT' }
        });

        console.log('[Garmin] Course creation response:', JSON.stringify(createRes));

        return NextResponse.json({
            success: true,
            message: 'Course created successfully in your Garmin account!',
            details: createRes
        });

    } catch (err: any) {
        console.error('Garmin export error:', err.message);
        let errorMessage = err.message || 'Failed to create course in Garmin.';
        if (err.response?.data) {
            errorMessage = `Garmin API Error: ${JSON.stringify(err.response.data)}`;
        }
        return NextResponse.json({ error: errorMessage }, { status: 500 });
    }
}
