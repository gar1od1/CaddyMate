# CaddyMate — working conventions

Read `docs/SPEC.md` first; section numbers below refer to it.

## Repo
- pnpm workspaces + Turborepo, hoisted `node_modules` (`.npmrc`). Node 22, pnpm 10.
- `apps/mobile` Expo SDK 57 + expo-router (`src/app` routes). `apps/web` Next.js 16 App Router.
  `packages/engine` pure TS golf maths. `packages/db` migrations + generated types.
  `packages/api` typed data-access layer. `packages/ui` design tokens. `supabase/functions` Edge Functions.
- Units: SI inside the engine and DB (metres, m/s, °C, hPa); yards/feet only at the UI edge via `@caddymate/engine` unit helpers.
- Club frame (§4): `+along` down the intended line, `+lateral` to the player's RIGHT.

## Commands (run from repo root; all must pass before you finish)
```
CI=true pnpm install --no-frozen-lockfile   # only if you add deps
pnpm format          # prettier --write
pnpm typecheck && pnpm lint && pnpm test
PGHOST=/tmp PGPORT=55432 PGUSER=postgres packages/db/scripts/local-db.sh   # migrations + RLS test (local Postgres is running)
(cd apps/web && NEXT_PUBLIC_SUPABASE_URL=https://example.supabase.co NEXT_PUBLIC_SUPABASE_ANON_KEY=x pnpm build)
(cd apps/mobile && EXPO_PUBLIC_SUPABASE_URL=https://example.supabase.co EXPO_PUBLIC_SUPABASE_ANON_KEY=x npx expo export --platform android --output-dir /tmp/expo-export)
```
- Engine: vitest coverage thresholds are 100 % (`packages/engine/vitest.config.ts`). Use fast-check property tests for maths invariants.
- Migrations: add a new file `packages/db/migrations/<timestamp>_<name>.sql`; never edit an applied one. Regenerate types with `pnpm --filter @caddymate/db db:types` after `local-db.sh`.
- No network docs access in this environment: docs.expo.dev, supabase.com, maplibre.org are blocked. Read the installed package's `.d.ts` / README in `node_modules` instead of guessing APIs. `npx expo install` cannot reach Expo's API — pin versions from `node_modules/expo/bundledNativeModules.json` and use `pnpm add`.
- MapLibre RN v11 API: `Map`, `Camera` (`initialViewState`, `center`), `GeoJSONSource`, `Layer type="fill|line|circle|symbol"`, `UserLocation`, `Marker`. See `node_modules/@maplibre/maplibre-react-native/lib/typescript/module/index.d.ts`.
- Supabase clients: mobile `apps/mobile/src/lib/supabase.ts`; web `apps/web/src/lib/supabase/{client,server}.ts`. Type them with `Database` from `@caddymate/db`.
- Do not commit; the orchestrator commits. Do not touch files outside the paths you were assigned unless told to. Do not modify `docs/SPEC.md` — if you must deviate, write a short note in `docs/decisions/NNN-<slug>.md`.
- Match surrounding style: comment density, naming, Prettier config (100 cols, single quotes).
