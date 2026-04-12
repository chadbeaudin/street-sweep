/**
 * Feature flags for StreetSweep.
 *
 * All flags that need to be accessible in client components MUST be prefixed
 * with NEXT_PUBLIC_ so Next.js inlines them at build time.
 *
 * To enable a flag, set the corresponding env var in .env.local or your
 * deployment environment:
 *
 *   NEXT_PUBLIC_ADVANCED_STRAVA_INTEGRATION=true
 */

export const featureFlags = {
    /**
     * When true, the Strava settings dialog exposes Client ID / Client Secret
     * fields so power-users can supply their own Strava API application and use
     * private-activity scopes.
     *
     * When false (the default), the app uses the server-side STRAVA_CLIENT_ID /
     * STRAVA_CLIENT_SECRET env vars and only requests public-route access
     * (scope: read,activity:read). Users never need to touch the Strava
     * developer portal.
     */
    advancedStravaIntegration:
        process.env.NEXT_PUBLIC_ADVANCED_STRAVA_INTEGRATION === 'true',
} as const;
