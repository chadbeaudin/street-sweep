export interface StravaActivity {
    id: number;
    name: string;
    map: {
        summary_polyline: string;
    };
    start_date: string;
}

export async function getStravaAccessToken(creds?: { clientId?: string; clientSecret?: string; refreshToken?: string }) {
    // Check if we received any non-empty credentials in the UI object
    const hasUICreds = !!(creds && (creds.clientId || creds.clientSecret || creds.refreshToken));

    const clientId = (creds?.clientId) || process.env.STRAVA_CLIENT_ID;
    const clientSecret = (creds?.clientSecret) || process.env.STRAVA_CLIENT_SECRET;
    const refreshToken = (creds?.refreshToken) || process.env.STRAVA_REFRESH_TOKEN;

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
        let errorMessage = `Failed to refresh Strava token: ${response.status} ${response.statusText}`;
        try {
            const errorJson = JSON.parse(errorText);
            if (errorJson.message) errorMessage += ` - ${errorJson.message}`;
            if (errorJson.errors) errorMessage += ` (${JSON.stringify(errorJson.errors)})`;
        } catch {
            errorMessage += ` - ${errorText.substring(0, 500)}`;
        }
        throw new Error(errorMessage);
    }

    const data = await response.json();
    const scopes = data.scope || 'NOT_RETURNED';
    console.log(`[Strava] Refresh successful. Scopes received: ${scopes}. Response keys: ${Object.keys(data).join(', ')}`);

    if (!data.access_token) {
        throw new Error('Strava token refresh response did not contain an access_token');
    }

    // Check for activity read permission in the scopes
    if (scopes !== 'NOT_RETURNED' && !scopes.includes('activity:read')) {
        console.warn(`[Strava] WARNING: Token refreshed but missing 'activity:read' scope. Current permitted scopes: ${scopes}`);
    }

    return data.access_token;
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
            let errorMessage = `Strava API error: ${response.status} ${response.statusText}`;
            try {
                const errorJson = JSON.parse(errorText);
                if (errorJson.message) errorMessage += ` - ${errorJson.message}`;
                if (errorJson.errors) errorMessage += ` (${JSON.stringify(errorJson.errors)})`;
            } catch {
                errorMessage += ` - ${errorText.substring(0, 500)}`;
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
