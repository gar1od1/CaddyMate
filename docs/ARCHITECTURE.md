# CaddyMate — Architecture

> Shot-dispersion and DECADE-style course-strategy app: an Expo mobile app for the course, a
> Next.js web app for import, course editing and review, a Garmin watch companion, and a Supabase
> backend — all sharing one pure-TypeScript golf engine.
>
> This is a **map of what is built** (September 2026, after spec phases 0–D). It is not the spec:
> for _what_ each part should do see [`SPEC.md`](SPEC.md); for _why_ a choice was made see
> [`decisions/`](decisions/README.md); for rules every contributor follows see the root
> [`CLAUDE.md`](../CLAUDE.md).

---

## 1. System overview

The defining idea is **one engine, many runtimes**. `packages/engine` holds all golf maths (geo,
condition model, dispersion fitting, strategy search, strokes gained, WHS) as pure functions. The
same source runs on the phone (Hermes), in the browser and Next.js server (webpack), and in Supabase
Edge Functions (Deno, via a vendored copy), so a pattern or recommendation cannot differ by where it
was computed.

The second idea is **local-first on the course**: the phone writes every shot to SQLite and pushes
it to Postgres in the background, so a dropped packet never loses a shot (SPEC §16).

```mermaid
flowchart TB
    Watch([Garmin watch]) <-->|Connect IQ messages, ADR 001| Mobile
    subgraph Mobile[apps/mobile — Expo]
      UI[expo-router screens] --> Engine1[@caddymate/engine]
      UI --> Local[(SQLite: rounds, shots, kv, blobs, sync_queue)]
      Local --> Sync[sync queue]
    end
    subgraph Web[apps/web — Next.js]
      Pages[App Router pages / route handlers] --> Engine2[@caddymate/engine]
    end
    Sync -->|@caddymate/api, user JWT| PG[(Supabase Postgres + PostGIS, RLS)]
    Pages -->|@caddymate/api, cookie session| PG
    Mobile -->|functions.invoke| EF[Edge Functions: weather · elevation · refit · finalise-round · import-sim]
    Web -->|functions.invoke| EF
    EF -->|user-scoped client| PG
    EF -->|service role: caches, patterns, Storage| PG
    EF --> Ext[Open-Meteo · Mapbox Terrain-RGB]
    EF --> Store[(Storage bucket: elevation)]
```

---

## 2. Technology stack

| Layer         | Technology                                                                         |
| ------------- | ---------------------------------------------------------------------------------- |
| Language      | TypeScript (strict) everywhere except the watch (Monkey C)                         |
| Monorepo      | pnpm 10 workspaces + Turborepo 2, hoisted `node_modules`; Node 22 (`.nvmrc`)       |
| Mobile        | Expo SDK 57, React Native (new architecture), expo-router, expo-sqlite, EAS Build  |
| Maps          | MapLibre RN v11 on mobile, `maplibre-gl` + mapbox-gl-draw on web; satellite raster |
| Web           | Next.js 16 App Router on webpack, React Server Components, Tailwind CSS 4          |
| Backend       | Supabase: Postgres 17 + PostGIS, Auth (email OTP), Storage, Edge Functions (Deno)  |
| Weather / DEM | Open-Meteo (no key); Mapbox Terrain-RGB when `MAPBOX_TOKEN` is set                 |
| Watch         | Garmin Connect IQ, Monkey C, Vivoactive 5 (not built by pnpm)                      |
| Tests         | Vitest (+ fast-check, v8 coverage), `deno test`, SQL RLS smoke test                |
| Tooling       | ESLint 9, Prettier 3 (100 cols, single quotes), GitHub Actions                     |

Rationale for each row: SPEC §3.1.

---

## 3. Repository layout

```
CaddyMate/
├── apps/
│   ├── mobile/                 # @caddymate/mobile — Expo app
│   │   └── src/
│   │       ├── app/            # expo-router routes (screens only)
│   │       ├── components/     # play/, review/, ui/ + CourseMap
│   │       ├── features/       # play/, review/, scorecard/ — pure logic + hooks, unit-tested
│   │       ├── data/           # SQLite store, sync queue, change events, actions
│   │       └── lib/            # env, supabase, auth, location, weather, terrain, garmin/
│   ├── web/                    # @caddymate/web — Next.js
│   │   └── src/
│   │       ├── app/            # App Router routes, route handlers, server actions
│   │       ├── components/     # charts/, course-editor/, import/, map/, review/
│   │       ├── lib/            # env, supabase/{client,server}, courses/, osm/, review/, sim/
│   │       └── proxy.ts        # session refresh + sign-in redirect (Next 16 "middleware")
│   └── watch/                  # Connect IQ app (manifest, resources, source/*.mc)
├── packages/
│   ├── engine/                 # @caddymate/engine — geo, units, conditions, dispersion,
│   │                           #   strategy, scoring, terrain, types
│   ├── db/                     # @caddymate/db — migrations/, tests/rls_smoke.sql,
│   │                           #   scripts/local-db.sh, src/database.types.ts (generated)
│   ├── api/                    # @caddymate/api — repositories over supabase-js
│   └── ui/                     # @caddymate/ui — colour, spacing, radius, type tokens
├── supabase/
│   ├── config.toml             # local CLI config (prod ref in the header comment)
│   └── functions/              # Edge Functions, _shared/, _shared/engine/ (vendored)
├── docs/
│   ├── SPEC.md                 # product + technical spec (do not edit; ADR instead)
│   ├── ARCHITECTURE.md         # this file
│   ├── standards/              # working-rules, web-ui, permissions
│   └── decisions/              # ADRs (index in README.md)
├── .github/                    # CI workflow, PR template
└── CLAUDE.md                   # standing instructions (authoritative)
```

---

## 4. Workspace packages

Dependencies point one way: `engine` ← `api` ← apps; `db` supplies types to `api` and the apps; `ui`
is leaf tokens. Packages ship TypeScript source (no build step); Next compiles them via
`transpilePackages`, Metro via the hoisted workspace, Deno via `deno.json` import mappings.

| Package             | Responsibility                                                                                                                                                                                                                                                                                                       | Rules                                                                                                                                           |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `@caddymate/engine` | All golf maths. `geo` (haversine, club frame), `units`, `conditions` (normalise ↔ apply, ADR 002), `dispersion` (fit, prior, cone/ellipse, sampling, ADR 003), `strategy` (DECADE search, ADR 004), `scoring` (baselines, SG, grading, Stableford, WHS), `terrain` (Terrain-RGB tiles, CMEG raster, grids), `types`. | Pure, deterministic, no IO or framework deps; SI units; 100 % coverage; each model has a `*_VERSION` constant written onto derived rows (§7.6). |
| `@caddymate/db`     | Timestamped SQL migrations, generated `Database` types, `SCHEMA_VERSION`, the RLS smoke test and `local-db.sh`.                                                                                                                                                                                                      | Never edit an applied migration; never hand-edit `database.types.ts`.                                                                           |
| `@caddymate/api`    | Typed repository functions (`profiles`, `clubs`, `courses`, `rounds`, `shots`, `patterns`, `review`, `weather`, `elevation`, ...) that take a `Db` (`SupabaseClient<Database>`) as their first argument, plus pure helpers shared by both apps (`hole`, `neutral`, `playgeo`, `buildRoundReview`).                   | The one place shared queries live. Functions mirrored in `supabase/functions/_shared/` must change here first (parity-tested).                  |
| `@caddymate/ui`     | Design tokens: `colors`, `spacing`, `radius`, `type`. Dark-first.                                                                                                                                                                                                                                                    | Mobile imports them directly; web maps them to CSS variables in `globals.css`.                                                                  |

---

## 5. App shells

### Mobile (`apps/mobile`)

`src/app/_layout.tsx` is the root: if `envProblem` is set it renders that message instead of the app
(§12); otherwise it wraps everything in `GestureHandlerRootView` + `AuthProvider` and a `Gate` that
redirects signed-out users to `/sign-in`, starts the sync queue while a session exists, and declares
the `Stack` screens with the `@caddymate/ui` theme. Screens are thin: logic lives in
`src/features/*` (pure, vitest-tested) and hooks next to it; persistence goes through `src/data`.
The play view computes recommendations on device (`features/play/recommendation.ts`, off the render
path in `useRecommendation`). MapLibre and expo-location are native, so Expo Go does not work — use
a development build (`apps/mobile/README.md`).

### Web (`apps/web`)

Server Components by default. `src/proxy.ts` refreshes the Supabase session cookie on every request
and redirects unauthenticated visitors to `/sign-in` (only `/sign-in` and `/auth/*` are public).
Pages load data through `@caddymate/api` with the cookie-bound server client; client components that
need interactivity (course editor, sim import, refit button) use the browser client. Route handlers
serve the OSM importer (`courses/import-osm`) and the MapLibre worker bundle
(`courses/maplibre/[file]`). UI rules: [`standards/web-ui.md`](standards/web-ui.md).

### Watch (`apps/watch`)

Display-only companion. The phone sends a complete, display-ready `state`; the watch sends `hello`,
`mark`, `holed` and `club` events with its own GPS fix. It never computes strategy (ADR 001). Not
yet compiled against the Connect IQ SDK.

---

## 6. Routing conventions

| Mobile (`src/app`)                                           | Web (`src/app`)                                         |
| ------------------------------------------------------------ | ------------------------------------------------------- |
| `index` — home                                               | `/` — home / nav                                        |
| `sign-in`                                                    | `/sign-in`, `/auth/callback` (OTP / code exchange)      |
| `bag`                                                        | `/clubs`, `/clubs/[clubId]` — patterns, ellipses, refit |
| `round/new`, `round/[id]` (play view)                        | `/courses`, `/courses/new`, `/courses/[id]`, `.../edit` |
| `round/[id]/scorecard`, `round/[id]/summary`                 | `/import` — sim CSV import (§12)                        |
| `review/[roundId]`, `review/trends`, `review/clubs/[clubId]` | `/review`, `/review/[roundId]`, `/review/trends`        |

- **Mobile:** every file in `src/app` is a screen, `_layout.tsx` defines navigators; non-route code
  never lives under `src/app`. New screens are registered in the root `Stack` with a title.
- **Web:** mutations are Server Actions co-located with the route (`courses/new/actions.ts`) or
  Edge Function calls from `lib/*/functions.ts`; app-specific components live in
  `src/components/<area>/`; pure logic lives in `src/lib/<area>/` with tests beside it.
- Both apps import shared code only from `@caddymate/*` packages — never from each other.

---

## 7. Authentication & session

- **Supabase Auth, email OTP** on both apps (`signInWithOtp` + `verifyOtp`); the web also accepts
  the magic-link / code exchange at `/auth/callback`. Redirect URLs are in `supabase/config.toml`
  (`caddymate://auth/callback` for mobile).
- A trigger (`handle_new_user`) creates the `profiles` row on sign-up.
- **Mobile:** `lib/supabase.ts` persists the session in the device keychain/keystore; `lib/auth.tsx` exposes `{ session, loading }`
  through context; `_layout.tsx` gates routes on it.
- **Web:** `@supabase/ssr` cookie sessions; `proxy.ts` is the gate; `lib/supabase/server.ts` for
  Server Components / Actions / Route Handlers, `lib/supabase/client.ts` in the browser.
- **Edge Functions** require `Authorization: Bearer <user JWT>`, verify it with Supabase Auth and
  read on the caller's behalf through a user-scoped client (`_shared/auth.ts`).

---

## 8. Local-first store & sync (mobile)

SPEC §16 "Sync"; code in `apps/mobile/src/data/`.

- `db.ts` opens `expo-sqlite` lazily (WAL) with tables `kv` (JSON cache: course bundles, clubs,
  profile, weather, patterns), `blobs` (elevation rasters), `rounds`, `shots`, `hole_scores` and
  `sync_queue`. Rows keep the domain object as JSON plus the columns queried on.
- `local.ts` is the typed read/write layer; every write calls `notifyChange()` (`events.ts`) so
  hooks re-read. `actions.ts` holds the round/hole operations screens call.
- `sync.ts` is the push queue. A write enqueues a **key** (`round:<id>` or `hole:<id>:<n>`), not a
  payload; flushing reads the current local state for the key and upserts it idempotently, so edits
  coalesce and retries can't duplicate or lose a shot. Rounds flush before holes; failures back off
  exponentially (max 60 s); the queue polls every 15 s and on app foreground.
- After a hole syncs, the affected clubs are refitted on device (`fitAndStoreClubPattern`) and the
  pattern caches refreshed (ADR 005). The server `refit` function is authoritative and overwrites.
- **Review:** `buildRoundReview` (pure, in `@caddymate/api`) runs on the local store for the
  instant review screen; `gradeRound` writes SG and grades to `shots` once the round is synced
  (`gradeRoundWhenSynced`). The web review reads those persisted columns.

---

## 9. Authorization & tenancy

Single-player today, multi-tenant by construction (SPEC §3.4). Full rules:
[`standards/permissions.md`](standards/permissions.md).

- **RLS on every table.** User-owned tables carry `user_id` and an owner-only policy
  (`profiles`, `clubs`, `rounds`, `shots`, `sim_sessions`, `devices`; `hole_scores` via its round).
- **Courses are shared-read, owner-write:** `can_read_course()` / `can_write_course()`
  (`security definer`) back the policies on `courses`, `course_versions`, `holes`, `hole_features`,
  `tee_sets`, `tee_markers`; edits go through the `course_*` RPCs (draft → publish, versioned).
- **Patterns:** owners read and (since `20260927000000_patterns_api.sql`) write their own
  `club_patterns` / `club_condition_patterns` (ADR 005).
- **Reference and cache tables** (`sg_baselines`, `weather_cache`, `elevation_grids`) are readable
  by any authenticated user and written only by Edge Functions with the service role.
- **Service role only in Edge Functions**, only for caches, Storage and pattern upserts (always
  filtered by the caller's user id). Never in a client.
- `packages/db/tests/rls_smoke.sql` acts as two users and fails on any cross-user read or write.

---

## 10. Data layer & migrations

- **Schema:** SPEC §6. Migrations in `packages/db/migrations/`, named `<YYYYMMDDHHMMSS>_<name>.sql`:

  | Migration                         | Adds                                                                 |
  | --------------------------------- | -------------------------------------------------------------------- |
  | `20260925000000_schema_v2.sql`    | All v2 tables, triggers, RLS policies, course read/write helpers     |
  | `20260926000001_course_rpcs.sql`  | Course document RPCs: create, get, save draft, publish, copy version |
  | `20260926000002_edge_support.sql` | `course_elevation_extent()`, `elevation` Storage bucket + policy     |
  | `20260927000000_patterns_api.sql` | Owner write policies on the two pattern tables (ADR 005)             |

- **Local verification:** `packages/db/scripts/local-db.sh` builds a throwaway database on plain
  Postgres + PostGIS with a stub `auth` schema, applies every migration in order in a single
  transaction each, mimics Supabase's grants and runs `tests/*.sql`. CI runs the same script
  against `postgis/postgis:17-3.5`.
- **Types:** `pnpm --filter @caddymate/db db:types` regenerates `database.types.ts` from that local
  database. Apps and `api` type their clients with `Database`.
- **Derived data provenance:** `engine_version` on pattern rows, `condition_model_version` on shots,
  strategy/condition/dispersion versions in recommendation snapshots. The `protect_recommendation`
  trigger makes `shots.recommendation` immutable once set (it is what the player saw).

---

## 11. Edge Functions & the vendored engine

Full reference: [`supabase/functions/README.md`](../supabase/functions/README.md).

| Function         | Role                                                                                       |
| ---------------- | ------------------------------------------------------------------------------------------ |
| `weather`        | Open-Meteo proxy with `weather_cache` read-through (~110 m × 1 h keys)                     |
| `elevation`      | Point heights, or a course elevation grid (CMEG raster in Storage + `elevation_grids` row) |
| `refit`          | Authoritative pattern refit (optionally re-normalising old shots, §7.6)                    |
| `finalise-round` | Re-chains shots, tallies `hole_scores`, sets gross/status, refits used clubs; idempotent   |
| `import-sim`     | GSPro / Square CSV → `sim_sessions` + `shots`, deduped, then refit (§12)                   |

- Each function is `handler.ts` (pure, dependencies injected, unit-tested) + `index.ts` (wiring).
- Functions are bundled only from `supabase/functions/`, so `_shared/engine/` is a **committed copy**
  of `packages/engine/src` produced by `pnpm vendor:engine`; `vendor_test.ts` fails when stale.
  `api` code the jobs need is mirrored by hand in `_shared/` and guarded by
  `mirror_parity_test.ts` / `parity_test.ts`.
- Dependencies use inline `npm:` specifiers; errors are `{ error: { code, message } }`.

---

## 12. Cross-cutting concerns

### Configuration & boot validation

| Surface        | Module                               | Behaviour on missing config                                                                    |
| -------------- | ------------------------------------ | ---------------------------------------------------------------------------------------------- |
| Mobile         | `apps/mobile/src/lib/env.ts`         | Never throws at import; exports `envProblem`, which the root layout renders instead of the app |
| Web            | `apps/web/src/lib/env.ts`            | Throws on first use, naming the variable and `.env.example`                                    |
| Web proxy      | `apps/web/src/proxy.ts`              | Falls back to `''` so the edge proxy never crashes                                             |
| Edge Functions | `supabase/functions/_shared/auth.ts` | `Deno.env` reads; `SUPABASE_*` injected by the platform, `MAPBOX_TOKEN` optional               |

Variables: `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`, `EXPO_PUBLIC_MAPBOX_TOKEN`
(optional); `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`. Templates in each app's
`.env.example`.

### Design system

Tokens in `@caddymate/ui` (dark-first: satellite map, white numerals, green accent). Mobile consumes
them directly; web mirrors them as CSS variables in `apps/web/src/app/globals.css` and uses Tailwind
utilities over them. Map overlay colours (cone, miss, hazards) are tokens too. Web rules:
[`standards/web-ui.md`](standards/web-ui.md).

### Units, frames, versions

SI internally, yards/feet only at the UI edge; club frame `+along` down the line, `+lateral` right
(SPEC §4). Model versions per SPEC §7.6.

### Observability

SPEC §16 calls for Sentry on mobile and web; it is **not yet installed**. Today: Edge Function logs
and version columns on derived rows.

---

## 13. Deployment & environments

| Concern        | Current state                                                                                                     |
| -------------- | ----------------------------------------------------------------------------------------------------------------- |
| Database       | `caddymate-prod` (eu-west-1; ref in `supabase/config.toml`). Local: Supabase CLI or `local-db.sh`.                |
| Migrations     | Applied by hand, in order. SPEC §3.3's "CI applies migrations on `main`" is **not yet automated**.                |
| Edge Functions | Deployed by hand with `supabase functions deploy` after `pnpm vendor:engine`; secrets via `supabase secrets set`. |
| Web            | Vercel per SPEC §3.1 (preview per PR); no Vercel config is committed in this repo.                                |
| Mobile         | EAS Build profiles `development` / `preview` (internal APK) / `production`; builds cut from tags (SPEC §3.3).     |
| Watch          | Sideloaded; needs the Connect IQ SDK to build.                                                                    |

Not yet done (README "Status"): physical-device run, prod deploy of migrations and functions,
Connect IQ compile.

---

## 14. Engineering workflow

- **Scripts** (root `package.json`): `dev`, `build`, `typecheck`, `lint`, `test` (Turborepo),
  `format` / `format:check` (Prettier), `vendor:engine`.
- **CI** (`.github/workflows/ci.yml`): job `check` runs `format:check → typecheck → lint → test`;
  job `db` runs `local-db.sh` against PostGIS 17. The web build, Expo export and Deno tests are
  run locally before a PR (CLAUDE.md §7).
- **Branching:** short-lived branches → PR → `main` (SPEC §3.3); Conventional Commits with scopes.
- **Rules and definition of done:** [`CLAUDE.md`](../CLAUDE.md),
  [`standards/working-rules.md`](standards/working-rules.md),
  [`.github/pull_request_template.md`](../.github/pull_request_template.md).
- **ADRs:** every deviation from SPEC or open default is recorded in `docs/decisions/`.

---

## 15. Where to go deeper

| You want...                          | Read                                                              |
| ------------------------------------ | ----------------------------------------------------------------- |
| Standing rules for contributors / AI | [`CLAUDE.md`](../CLAUDE.md)                                       |
| What the product should do           | [`SPEC.md`](SPEC.md)                                              |
| Why a choice was made                | [`decisions/`](decisions/README.md)                               |
| How to work (plan, verify, PR)       | [`standards/working-rules.md`](standards/working-rules.md)        |
| Web UI rules                         | [`standards/web-ui.md`](standards/web-ui.md)                      |
| RLS, roles, service-role use         | [`standards/permissions.md`](standards/permissions.md)            |
| Edge Function contracts              | [`supabase/functions/README.md`](../supabase/functions/README.md) |
| Watch protocol and layout            | [`apps/watch/README.md`](../apps/watch/README.md), ADR 001        |
| The exact schema                     | `packages/db/migrations/` (in order), `database.types.ts`         |
| The maths                            | `packages/engine/src/<module>/` and its tests                     |

---

_Maintenance: this file describes the system as built. When a package, route group, Edge Function,
data flow or deployment step changes materially, update the matching section in the same change._
