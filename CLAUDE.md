# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

StreetSweep helps cyclists/runners find and route streets they haven't ridden. It imports Strava rides, overlays them on a map, and generates optimized coverage routes by solving the **Chinese Postman Problem** (odd-degree node matching + Eulerian trail) over a bounded street network.

## Commands

- `npm run dev` — dev server on **port 3888** (not 3000).
- `./start.sh` — kills existing node, then runs dev piped to `/tmp/streetsweep.log`.
- `npm run build` / `npm start` — production build (`output: 'standalone'`) / serve.
- `npm run lint`
- `npm test` — Jest unit tests (node env, `*.test.ts(x)` outside `tests/integration/`).
- `npm run test:integration` — separate config (`jest.integration.config.js`), 90s timeout, only `tests/integration/**`.
- Single test: `npx jest lib/graph.test.ts` or `npx jest -t "test name"`.
- Prisma client is generated to `lib/generated/prisma` via `postinstall`; regenerate with `npx prisma generate`.

## Server Logs
The dev server logs to `/tmp/streetsweep.log` (piped via `start.sh`).
To check logs: `tail -f /tmp/streetsweep.log` or `cat /tmp/streetsweep.log`.

## Architecture

Next.js 14 App Router, TypeScript, TailwindCSS. Path alias `@/` maps to repo root.

**Client** (`app/page.tsx`, ~1400 lines) holds nearly all UI state (selection boxes/polygons, waypoints, manual route, undo/redo history) and orchestrates calls to the API routes. `components/Map.tsx` (~1100 lines, dynamically imported with `ssr: false` since Leaflet needs `window`) renders the Leaflet map and drawing interactions.

**Routing engine** (`lib/graph.ts`, ~2500 lines) is the core. `StreetGraph` builds an `ngraph` graph from OSM data, indexes nodes/edges into spatial cells, marks "ridden" edges from Strava polylines, and exposes:
- `solveCPP(...)` — the Chinese Postman solver; the main entry point producing the coverage route.
- `buildGeographicEulerianTrail(...)` — orders the Eulerian traversal geographically.
- `findPath` / `findClosestTarget*` — A* shortest paths (`ngraph.path`) with a ridden-edge penalty.
- `StreetGraph.getCachedGraph(bbox, data, ...)` — **module-level `GRAPH_CACHE`** keyed by bbox so multiple `/api/step`, `/api/snap`, `/api/path` calls reuse one built graph. Prefer this over constructing graphs directly in routes.

**OSM data** (`lib/overpass.ts`) fetches street geometry from the Overpass API with a layered cache: in-memory → Postgres `osm_cache` (via `lib/osmDiskCache.ts` / Prisma) → network. Requests are **snapped to a ~500m tile grid** (`TILE_DEG = 0.005`, cache keys prefixed `v4_`) so panning reuses tiles. Circuit breakers back off on 429/504/509. When touching caching, mind the cache-key version prefix and bbox-coverage validation logic.

**API routes** (`app/api/*/route.ts`), all POST:
- `generate` — full CPP route for selected boxes/polygons (waypoints, manual route, exit/approach routes, ridden penalty).
- `step` / `snap` / `path` — interactive per-click routing, snapping, point-to-point paths.
- `roads` — raw OSM ways for a bbox.
- `import` — parses uploaded `.fit`/GPX into coords + elevation.
- `export/fit`, `export/garmin` — GPX/FIT export; garmin uses `garmin-connect` to upload directly.
- `strava/{auth,exchange,activities}` — OAuth + activity import.
- `stats` — coverage % per country/state/city/county via Nominatim reverse-geocoding.

**Strava** (`lib/strava.ts`, `lib/stravaCache.ts`): OAuth token exchange and activity fetch. By default uses server-side `STRAVA_CLIENT_ID/SECRET/REFRESH_TOKEN` with public scopes. The `advancedStravaIntegration` feature flag (`lib/featureFlags.ts`, gated on `NEXT_PUBLIC_ADVANCED_STRAVA_INTEGRATION`) lets power-users supply their own app credentials for private scopes. Client-visible flags must be `NEXT_PUBLIC_`-prefixed.

**Elevation** (`lib/elevation.ts`): multi-provider fallback — Open Topo Data (primary) → Open-Meteo (batched fallback) — switching on outage/rate-limit.

**Geocoding** (`lib/nominatim.ts`): reverse geocode + city polygon search for stats; serialized behind a mutex and backs off on sustained 429s.

**Persistence** (Prisma + Neon serverless Postgres, `lib/prisma.ts`): models `OsmCache`, `Route`, `Collection`, `CollectionRoute`, `StravaActivity`, `StatsCache`. `prisma.config.ts` loads env via `dotenv`. No local DB migrations workflow — schema in `prisma/schema.prisma`.

## Notes

- Env vars: `DATABASE_URL`, `STRAVA_CLIENT_ID`, `STRAVA_CLIENT_SECRET`, `STRAVA_REFRESH_TOKEN` (in `.env` / `.env.local`).
- `scripts/` holds ad-hoc analysis/verification scripts (e.g. `analyze-cpp-optimality.ts`, euler/RPP checks), not part of the app build.
- `instrumentation.ts` logs the app version on nodejs runtime startup (`instrumentationHook` experimental flag).
