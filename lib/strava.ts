import polyline from '@mapbox/polyline';
import { isBikingActivity } from './stats';

export interface StravaActivity {
    id: number;
    name: string;
    map: {
        summary_polyline: string;
    };
    start_date: string;
    total_elevation_gain?: number; // meters; Strava returns 0 if unknown
    type: string;
    sport_type?: string;
}

export interface RiddenActivities {
    riddenRoads: [number, number][][];
    activityElevations: number[];
    activityTypes: string[];
}

// Single source of truth for what the app treats as "ridden": cycling activities
// only. Non-cycling activities (walks/hikes/runs) are dropped here so they never
// reach the map overlay, coverage stats, or the routing ridden-penalty.
export async function fetchCyclingRiddenRoads(creds?: { clientId?: string; clientSecret?: string; refreshToken?: string }): Promise<RiddenActivities> {
    const all = await fetchAllStravaActivities(creds);
    const cycling = all.filter(a => isBikingActivity(a.sport_type || a.type));
    return {
        riddenRoads: cycling.map(a => polyline.decode(a.map.summary_polyline) as [number, number][]),
        activityElevations: cycling.map(a => a.total_elevation_gain ?? 0),
        activityTypes: cycling.map(a => a.sport_type || a.type || ''),
    };
}

export async function getStravaAccessToken(creds?: { clientId?: string; clientSecret?: string; refreshToken?: string }) {
    // Check if we received any non-empty credentials in the UI object
    const hasUICreds = !!(creds && (creds.clientId || creds.clientSecret || creds.refreshToken));

    // Use UI value if present (even if empty string, but we trim first), otherwise fallback to ENV
    const clientId = (creds?.clientId?.trim() || process.env.STRAVA_CLIENT_ID?.trim());
    const clientSecret = (creds?.clientSecret?.trim() || process.env.STRAVA_CLIENT_SECRET?.trim());
    const refreshToken = (creds?.refreshToken?.trim() || process.env.STRAVA_REFRESH_TOKEN?.trim());

    const source = hasUICreds ? 'UI' : 'ENV';
    console.log(`[Strava] Attempting token refresh. Source: ${source}, ClientID: ${clientId?.substring(0, 5)}..., Token: ${refreshToken?.substring(0, 8)}...`);

    if (!clientId || !clientSecret || !refreshToken) {
        throw new Error(`Missing Strava credentials (${source}). Please configure them in Settings or your environment variables.`);
    }

    const params = new URLSearchParams();
    params.append('client_id', clientId);
    params.append('client_secret', clientSecret);
    params.append('refresh_token', refreshToken);
    params.append('grant_type', 'refresh_token');

    const response = await fetch('https://www.strava.com/oauth/token', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: params.toString()
    });

    if (!response.ok) {
        const errorText = await response.text();
        if (errorText.trimStart().startsWith('<')) {
            throw new Error('Strava is temporarily unavailable. Please try again in a few minutes.');
        }
        let errorMessage = `Failed to refresh Strava token: ${response.status} ${response.statusText}`;
        try {
            const errorJson = JSON.parse(errorText);
            if (errorJson.message) errorMessage += ` - ${errorJson.message}`;
            if (errorJson.errors) errorMessage += ` (${JSON.stringify(errorJson.errors)})`;
        } catch {
            errorMessage += ` - ${errorText.substring(0, 200)}`;
        }
        throw new Error(errorMessage);
    }

    const data = await response.json();
    const responseKeys = Object.keys(data);
    const receivedScope = data.scope || 'NOT_RETURNED';

    console.log(`[Strava] Refresh successful. Response Keys: ${responseKeys.join(', ')}`);
    console.log(`[Strava] Scope in response: ${receivedScope}`);

    if (!data.access_token) {
        throw new Error('Strava token refresh response did not contain an access_token');
    }

    // Check for activity read permission in the scopes
    if (receivedScope !== 'NOT_RETURNED' && !receivedScope.includes('activity:read')) {
        console.warn(`[Strava] WARNING: Token refreshed but missing 'activity:read' scope. Current permitted scopes: ${receivedScope}`);
    } else if (receivedScope === 'NOT_RETURNED') {
        console.log(`[Strava] Note: No scope returned in refresh response. This usually means scopes remain unchanged.`);
    }

    return data.access_token;
}

export async function getStravaAthleteId(accessToken: string): Promise<string> {
    const res = await fetch('https://www.strava.com/api/v3/athlete', {
        headers: { 'Authorization': `Bearer ${accessToken}` }
    });
    if (!res.ok) throw new Error(`Strava /athlete failed: ${res.status}`);
    const data = await res.json();
    if (!data?.id) throw new Error('Strava /athlete response missing id');
    return String(data.id);
}

export async function fetchAllStravaActivities(creds?: { clientId?: string; clientSecret?: string; refreshToken?: string }): Promise<StravaActivity[]> {
    const accessToken = await getStravaAccessToken(creds);
    let page = 1;
    const perPage = 200;
    const allActivities: StravaActivity[] = [];
    let hasMore = true;

    while (hasMore) {
        const response = await fetch(`https://www.strava.com/api/v3/athlete/activities?page=${page}&per_page=${perPage}`, {
            headers: {
                'Authorization': `Bearer ${accessToken}`
            }
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error(`[Strava] Activities fetch failed. Status: ${response.status}, Body: ${errorText.substring(0, 500)}`);
            if (errorText.trimStart().startsWith('<')) {
                throw new Error('Strava is temporarily unavailable. Please try again in a few minutes.');
            }
            let errorMessage = `Strava API error: ${response.status} ${response.statusText}`;
            try {
                const errorJson = JSON.parse(errorText);
                if (errorJson.message) errorMessage += ` - ${errorJson.message}`;
                if (errorJson.errors) errorMessage += ` (${JSON.stringify(errorJson.errors)})`;
            } catch {
                errorMessage += ` - ${errorText.substring(0, 200)}`;
            }
            throw new Error(errorMessage);
        }

        const activities = await response.json() as StravaActivity[];
        if (activities.length === 0) {
            hasMore = false;
        } else {
            // Only include activities with polylines
            allActivities.push(...activities.filter(a => a.map && a.map.summary_polyline));
            page++;
        }

        // Safety limit to avoid infinite loops
        if (page > 10) hasMore = false;
    }

    return allActivities;
}
