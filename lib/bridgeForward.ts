// Forwards the owner's newly created Strava activities to mywhoosh-garmin-bridge (#138),
// which can't have its own push subscription since Strava allows one per app.
// A no-op until BRIDGE_URL, BRIDGE_SECRET and BRIDGE_ATHLETE_ID are set, and never
// throws: a bridge outage must not fail or retry the athlete's sync. The bridge
// reconciles against MyWhoosh on its own schedule to cover anything dropped here.
import type { StravaSyncEvent } from './generated/prisma/client';

const TIMEOUT_MS = 5000;

// Created in this batch and not deleted again afterwards.
export function createdActivityIds(events: Pick<StravaSyncEvent, 'aspect' | 'activityId'>[]): string[] {
    const created = new Set<string>();
    for (const e of events) {
        if (!e.activityId) continue;
        if (e.aspect === 'create') created.add(e.activityId);
        else if (e.aspect === 'delete') created.delete(e.activityId);
    }
    return [...created];
}

export async function forwardToBridge(athleteId: string, accessToken: string, events: StravaSyncEvent[]): Promise<void> {
    const { BRIDGE_URL: url, BRIDGE_SECRET: secret, BRIDGE_ATHLETE_ID: owner } = process.env;
    if (!url || !secret || athleteId !== owner) return;
    for (const activityId of createdActivityIds(events)) {
        try {
            const res = await fetch(`https://www.strava.com/api/v3/activities/${activityId}`, {
                headers: { Authorization: `Bearer ${accessToken}` },
                signal: AbortSignal.timeout(TIMEOUT_MS),
            });
            if (!res.ok) throw new Error(`Strava activity fetch failed: ${res.status}`);
            const a = await res.json();
            const sent = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-Bridge-Secret': secret },
                body: JSON.stringify({
                    id: a.id,
                    athlete_id: Number(athleteId),
                    aspect_type: 'create',
                    start_date: a.start_date,
                    device_name: a.device_name ?? null,
                    sport_type: a.sport_type ?? null,
                    total_photo_count: a.total_photo_count ?? 0,
                    name: a.name ?? null,
                }),
                signal: AbortSignal.timeout(TIMEOUT_MS),
            });
            if (!sent.ok) throw new Error(`bridge answered ${sent.status}`);
        } catch (e: any) {
            console.warn(`Bridge forward of activity ${activityId} failed: ${e.message}`);
        }
    }
}
