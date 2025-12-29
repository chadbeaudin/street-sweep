export interface StravaActivity {
    id: number;
    name: string;
    map: {
        summary_polyline: string;
    };
    start_date: string;
}

export async function getStravaAccessToken(creds?: { clientId?: string; clientSecret?: string; refreshToken?: string }) {
    const clientId = creds?.clientId || process.env.STRAVA_CLIENT_ID;
    const clientSecret = creds?.clientSecret || process.env.STRAVA_CLIENT_SECRET;
    const refreshToken = creds?.refreshToken || process.env.STRAVA_REFRESH_TOKEN;

    if (!clientId || !clientSecret || !refreshToken) {
        throw new Error('Missing Strava credentials. Please configure them in Settings.');
    }

    const response = await fetch('https://www.strava.com/oauth/token', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            client_id: clientId,
            client_secret: clientSecret,
            refresh_token: refreshToken,
            grant_type: 'refresh_token'
        })
    });

    if (!response.ok) {
        const error = await response.text();
        throw new Error(`Failed to refresh Strava token: ${error}`);
    }

    const data = await response.json();
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
            throw new Error(`Strava API error: ${response.status} ${response.statusText}`);
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
