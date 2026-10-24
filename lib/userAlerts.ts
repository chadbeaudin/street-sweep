import { sendTelegramMessage } from './telegram';

const VISIT_GAP_MS = 60 * 60 * 1000;
const lastAlerted = new Map<string, number>();

interface AlertUser { id: string; name?: string | null; athleteId?: string | null; isAdmin?: boolean; createdAt?: Date; lastSeenAt?: Date | null }

function describe(user: AlertUser): string {
    return `${user.name ?? 'unknown'} (https://www.strava.com/athletes/${user.athleteId ?? user.id})`;
}

export function alertNewUser(user: AlertUser): void {
    void sendTelegramMessage(`StreetSweep: new user signed up: ${describe(user)}`);
}

// Beta-only (#134): one message per visit, i.e. first activity after an hour away.
export function alertUserActive(user: AlertUser, now = Date.now()): void {
    if (user.isAdmin) return;
    if (user.createdAt && now - user.createdAt.getTime() < VISIT_GAP_MS) return;
    if (user.lastSeenAt && now - user.lastSeenAt.getTime() < VISIT_GAP_MS) return;
    if (now - (lastAlerted.get(user.id) ?? -Infinity) < VISIT_GAP_MS) return;
    lastAlerted.set(user.id, now);
    void sendTelegramMessage(`StreetSweep: ${describe(user)} is using the app`);
}
