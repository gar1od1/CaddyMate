# Edge Functions

Deno functions deployed to Supabase. Third-party API access lives here so keys
never ship in the apps (docs/SPEC.md §16). Every request must carry the caller's
Supabase access token (`Authorization: Bearer <jwt>`); it is verified with
Supabase Auth, and anything read on the caller's behalf goes through a
user-scoped client so RLS applies. The service role is used only to write the
cache tables (`weather_cache`, `elevation_grids`) and the `elevation` Storage
bucket.

| Function    | Request                                      | Response                                                                                                    |
| ----------- | -------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `weather`   | `GET ?lat=&lng=[&at=<ISO 8601>]`             | `{ windSpeedMps, windFromDeg, gustMps?, tempC, pressureHpa, observedAt, source, cached, latR, lngR, hour }` |
| `elevation` | `POST { points: [{ lat, lng }, …] }` (≤ 500) | `{ source: 'mapbox' \| 'open-meteo', heightsM: number[] }`                                                  |
| `elevation` | `POST { courseId, version?, force? }`        | `{ courseId, version, bbox, resolutionM, storagePath, minM, maxM, reused, width?, height?, source? }`       |

Errors are `{ error: { code, message } }` with 400 / 401 / 404 / 405 / 413 / 422
(`at` beyond the 16-day forecast) / 502 / 504 (upstream timeout).

**weather** — Open-Meteo, no key. `at` within 30 min of now uses the `current`
block; up to 92 days back or 16 days ahead the matching `hourly` slot of the
forecast API; older hours the archive API. Wind is 10 m in m/s, direction is
where it blows FROM, pressure is surface (station) pressure. Read-through cache
in `weather_cache`, keyed by lat/lng rounded to 3 dp (~110 m) and the UTC hour;
an entry fetched after its hour ended is final, otherwise it is refreshed after
30 min.

**elevation** — Mapbox Terrain-RGB z15 tiles when `MAPBOX_TOKEN` is set,
otherwise the Open-Meteo Elevation API (Copernicus 90 m DEM). For a course, the
bbox is the course boundary — or, without one, all hole geometry of the version
(`course_elevation_extent()` RPC, called as the user) — buffered by 100 m. The
grid is 2 m (Mapbox, resampled from the ~3 m tiles) or 10 m (Open-Meteo, sampled
every 30 m then resampled: the source DEM is 90 m). It is stored as a CMEG
raster (`packages/engine/src/terrain/raster.ts`; decode with
`decodeGridRaster`) at `elevation/<courseId>/v<version>.cmeg`, and
`elevation_grids` is upserted. An existing grid is returned as-is unless
`force: true`.

## Environment

| Variable                    | Required | Notes                                                          |
| --------------------------- | -------- | -------------------------------------------------------------- |
| `SUPABASE_URL`              | auto     | Injected by Supabase.                                          |
| `SUPABASE_ANON_KEY`         | auto     | Injected; used with the caller's JWT.                          |
| `SUPABASE_SERVICE_ROLE_KEY` | auto     | Injected; cache/Storage writes only.                           |
| `MAPBOX_TOKEN`              | optional | Enables Terrain-RGB elevation. Without it, Open-Meteo is used. |

```sh
supabase secrets set MAPBOX_TOKEN=pk.…        # optional
supabase functions deploy weather elevation   # --project-ref mceverccxohligbwpdwd for prod
```

The `elevation` bucket and `course_elevation_extent()` come from migration
`packages/db/migrations/20260926000002_edge_support.sql` (the bucket insert is
skipped on plain Postgres without a `storage` schema).

## Layout and tests

- `_shared/` — auth, CORS, JSON errors, fetch-with-timeout, elevation providers,
  and `terrain.ts` / `weather.ts`: copies of `packages/engine/src/terrain`
  (functions are bundled from this directory only, so they do not import the
  engine). Change the engine first, then the copy; `_shared/parity_test.ts`
  fails if they diverge.
- `<name>/handler.ts` — request handling with injected dependencies (unit
  tested); `<name>/index.ts` — wiring to Supabase and `Deno.serve`.
- Dependencies use inline `npm:` specifiers so each function deploys without an
  import map; `deno.json` holds test-only imports and tasks.

```sh
cd supabase/functions
deno task test    # unit + parity tests (no network)
deno task check   # type-check the entrypoints
deno lint        # formatting is Prettier (`pnpm format` at the repo root), not deno fmt
```
