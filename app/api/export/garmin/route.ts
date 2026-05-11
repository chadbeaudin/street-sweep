import { NextResponse } from 'next/server';
import { GarminConnect } from 'garmin-connect';

export async function POST(req: Request) {
    try {
        const { route, name, email, password } = await req.json();

        if (!route || !email || !password) {
            return NextResponse.json({ error: 'Missing required data' }, { status: 400 });
        }

        // 1. Login to Garmin Connect
        const GCClient = new GarminConnect({
            username: email,
            password: password
        });

        await GCClient.login();

        // 2. Prepare JSON Course Data (CourseDTO)
        // Based on Garmin's internal schema requirements
        let totalDist = 0;
        let totalTime = 0;
        const MOCK_SPEED = 5; // 5 m/s (~18 km/h) to generate increasing time

        const geoPoints = route.map((pt: any, i: number) => {
            if (i > 0) {
                const p1 = route[i-1];
                const d = haversineM(p1[1], p1[0], pt[1], pt[0]);
                totalDist += d;
                totalTime += Math.max(1, Math.round(d / MOCK_SPEED));
            }
            return {
                latitude: pt[1],
                longitude: pt[0],
                elevation: pt[2] || 0,
                distance: totalDist,
                time: totalTime
            };
        });

        const coursePayload = {
            courseName: name || 'StreetSweep Route',
            activityTypePk: 2, // Cycling
            rulePK: 2,         // Private (1=Public, 2=Private, 4=Group)
            sourceTypeId: 2,   // Manual/Web
            startPoint: {
                latitude: route[0][1],
                longitude: route[0][0]
            },
            geoPoints: geoPoints
        };

        // 3. POST to Course Service
        // This creates the course directly in the user's account
        const url = 'https://connectapi.garmin.com/course-service/course';
        const createRes = await GCClient.post(url, coursePayload, {
            headers: {
                'Content-Type': 'application/json',
                'NK': 'NT'
            }
        });

        console.log('[Garmin] Direct Course Creation Response:', JSON.stringify(createRes));

        return NextResponse.json({ 
            success: true, 
            message: 'Course created successfully in your Garmin account!',
            details: createRes
        });

    } catch (err: any) {
        console.error('Garmin Course Creation error:', err);
        return NextResponse.json({ 
            error: err.message || 'Failed to create course in Garmin.' 
        }, { status: 500 });
    }
}

function haversineM(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371000;
    const toR = (d: number) => d * Math.PI / 180;
    const dLat = toR(lat2 - lat1), dLon = toR(lon2 - lon1);
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(toR(lat1)) * Math.cos(toR(lat2)) * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}


