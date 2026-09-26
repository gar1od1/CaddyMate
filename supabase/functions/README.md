# Edge Functions

Deno functions deployed to Supabase. Third-party API access lives here so keys
never ship in the apps (docs/SPEC.md §16). Every request must carry the caller's
Supabase access token (`Authorization: Bearer <jwt>`); it is verified with
Supabase Auth, and anything read on the caller's behalf goes through a
user-scoped client so RLS applies. The service role is used only to write the
cache tables (`weather_cache`, `elevation_grids`), the `elevation` Storage
bucket and the pattern tables (`club_patterns`, `club_condition_patterns`,
always filtered by the caller's user id).

| Function    | Request                                      | Response                                                                                                    |
| ----------- | -------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `weather`   | `GET ?lat=&lng=[&at=<ISO 8601>]`             | `{ windSpeedMps, windFromDeg, gustMps?, tempC, pressureHpa, observedAt, source, cached, latR, lngR, hour }` |
| `elevation` | `POST { points: [{ lat, lng }, …] }` (≤ 500) | `{ source: 'mapbox' \| 'open-meteo', heightsM: number[] }`                                                  |
| `elevation` | `POST { courseId, version?, force? }`        | `{ courseId, version, bbox, resolutionM, storagePath, minM, maxM, reused, width?, height?, source? }`       |

Jobs (SPEC §8.8, §12):

| Function         | Request                                                                                        | Response                                                                                                                         |
| ---------------- | ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `refit`          | `POST { clubIds?: uuid[], recomputeNeutral?: boolean }`                                        | `{ clubs: [{ clubId, name, n_raw, n_effective, confidence, buckets, fitted_at }], notFound, skipped, neutralUpdated }`           |
| `finalise-round` | `POST { roundId }`                                                                             | `{ roundId, gross, status, holes: [{ holeNumber, strokes, strokesLogged, putts, penalties, holed }], shotsUpdated, clubsRefit }` |
| `import-sim`     | `POST { source: 'gspro' \| 'square', csv, clubAliases?: { name: clubId }, utcOffsetMinutes? }` | `{ sessionId, duplicate, format, detected, inserted, skipped, skippedDetail, unmappedClubs, clubsRefit }`                        |

Errors are `{ error: { code, message } }` with 400 / 401 / 403 (`forbidden`: the caller
lacks the permission key, docs/standards/permissions.md) / 404 / 405 / 409 / 413
/ 422 (`at` beyond the 16-day forecast; unparseable CSV) / 502 / 504 (upstream
timeout).

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

**refit** — the authoritative pattern refit (SPEC §8.8, decision 005). For each
requested club (default: all the caller's clubs; putters are listed in
`skipped`) all its shots are loaded — course shots by `neutral_*`, sim shots by
`sim_total_m` / `sim_offline_m` — mapped to `PatternShot` exactly as
`@caddymate/api` `patterns.ts` does, and fitted with `fitPattern` + the prior
(`priorFor`: the club's `stock_total_m`, the driver's `stock_total_m` as the
driver distance, the handicap band of `profiles.handicap_index_official` or 13)
and `recency_half_life_days`, plus `fitConditionPatterns` on the observed
results. `club_patterns` is upserted and `club_condition_patterns` replaced
(stale buckets deleted) with the service role and `fitted_at` = now, so the
server result wins over the device's incremental refit. `recomputeNeutral: true`
first re-runs `normaliseShot` for every course shot of those clubs whose
`condition_model_version` is null or older than the engine's (SPEC §7.6), using
the stored conditions snapshot (its `elevation_*_m`; no grid), the club, the
profile handedness and the pin (round override, else green centre).

**finalise-round** — for each hole with course shots: `recomputeHoleShots`
(re-chain, renumber `seq` 1..n, observed / neutral / distance-to-pin) and only
changed derived columns are written back (renumbered shots are parked at
`seq + 1000` first because `(round_id, hole_number, seq)` is unique).
`result_surface` is kept from what the device stored (hole features are not
loaded server-side). `tallyHole` → `hole_scores` (manual overrides and points
kept); `rounds.gross` = Σ override-or-logged strokes over all `hole_scores`;
`status` becomes `complete` if still `live`; `finished_at` is set if empty.
Then every club used on a hole is refitted. Strokes gained and grades are not
computed here: see the `reviewRoundHook` TODO in `finalise-round/handler.ts`.
Idempotent.

**import-sim** — SPEC §12. `_shared/simcsv.ts` finds the header row (first of
20 lines with a club and a carry column; preambles are skipped), maps columns by
header synonyms, and reads units from the header (`Carry (m)`, `Carry [yds]`,
`carry_m`) or a units row under it (GSPro), defaulting to yards / mph. `;` files
may use decimal commas; lateral accepts `12.3 L`, `R4`, `-5` (+ right).
Timestamps: ISO (explicit zone wins), `YYYY-MM-DD hh:mm[:ss]`, `M/D/YYYY h:mm
[AM|PM]` (D/M when the first part > 12), `D.M.YYYY`, or separate Date / Time
columns; zone-less times are shifted by `utcOffsetMinutes` (default 0). `detected`
reports which format the header signature matched (heuristic — the fixtures in
`_shared/fixtures/` are modelled on the documented columns, not real exports).
Clubs resolve via `clubAliases` (must be the caller's clubs), then each club's
`sim_name_aliases`, then its name (case-insensitive); unmatched names are
returned in `unmappedClubs` and the new aliases are appended to
`clubs.sim_name_aliases`. Dedupe: the whole file by SHA-256 of its text
(line endings normalised) against `sim_sessions.file_hash` (a duplicate returns
the earlier `sessionId`, `duplicate: true`), then shots by (club, carry within
0.005 m, timestamp ±1 s) against existing sim shots and within the file. Inserts
`sim_sessions` (raw rows, headers and units in `raw_payload`) and `shots`
(`source = 'sim'`, `sim_carry_m` / `sim_total_m` / `sim_offline_m` in metres,
`strike = 'good'`); shots without a timestamp get the import time, 1 s apart. A
failed shot insert deletes the session. Then the affected clubs are refitted.

## Vendored engine

The job functions need the full engine (conditions, dispersion, geo), and
functions are bundled from `supabase/functions` only, so
`_shared/engine/` is a committed copy of `packages/engine/src` made by

```sh
pnpm vendor:engine    # node supabase/functions/scripts/vendor-engine.mts
```

It copies every non-test `.ts` file, prepends a "generated" header and rewrites
relative `./x.js` specifiers to `./x.ts` (Deno needs the real extension).
`_shared/vendor_test.ts` fails with "run `pnpm vendor:engine`" whenever the copy
differs from what the script would produce, so run it after every engine change.
Pure `@caddymate/api` code the jobs need (`patterns.ts` mapping and fit,
`hole.ts`, `neutral.ts`, `geography.ts`, row mapping) is mirrored by hand in
`_shared/` on top of the vendored engine; `_shared/mirror_parity_test.ts` runs
the api's own code on the same fixtures (including `fitAndStoreClubPattern`
against a recording client) — change the api first, then the mirror.

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
pnpm vendor:engine                            # after any engine change (test enforces it)
supabase functions deploy refit finalise-round import-sim
```

No migration is needed for the jobs: they use the tables and RLS of
`20260925000000_schema_v2.sql` and `20260927000000_patterns_api.sql`.

The `elevation` bucket and `course_elevation_extent()` come from migration
`packages/db/migrations/20260926000002_edge_support.sql` (the bucket insert is
skipped on plain Postgres without a `storage` schema).

## Layout and tests

- `_shared/` — auth, CORS, JSON errors, fetch-with-timeout, elevation providers,
  and `terrain.ts` / `weather.ts`: copies of `packages/engine/src/terrain`
  (functions are bundled from this directory only, so they do not import the
  engine). Change the engine first, then the copy; `_shared/parity_test.ts`
  fails if they diverge.
- `_shared/engine/` — the vendored engine (above); `_shared/{patterns,hole,
neutral,geography,shots,types}.ts` — api mirrors; `refit.ts` — the refit job;
  `store.ts` — Supabase-backed stores (`fake_store.ts` is the in-memory test
  double); `simcsv.ts` — the CSV parser.
- `<name>/handler.ts` — request handling with injected dependencies (unit
  tested); `<name>/index.ts` — wiring to Supabase and `Deno.serve`.
- Dependencies use inline `npm:` specifiers so each function deploys without an
  import map; `deno.json` holds test-only imports and tasks.

```sh
cd supabase/functions
deno task test    # unit + parity + vendored-engine tests (no network once cached)
deno task check   # type-check the entrypoints
deno lint        # formatting is Prettier (`pnpm format` at the repo root), not deno fmt
```
