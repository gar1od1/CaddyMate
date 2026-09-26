# Working rules

How contributors — human or AI — work in CaddyMate: planning, asking, staying in scope, verifying,
recording deviations and shipping. The root [`CLAUDE.md`](../../CLAUDE.md) §10 carries the short
form; this is the full text. The domain rules (units, club frame, engine purity) live in `CLAUDE.md`
§4 and are not repeated here.

---

## 1. Plan before you type

1. **Read first.** `CLAUDE.md`, the SPEC sections your task names, the ADRs that touch the same
   module (`docs/decisions/README.md`), and the standard for the kind of change
   (`CLAUDE.md` §3). Then read the code you will change and its tests.
2. **Find the owner of the logic.** Maths goes in `packages/engine`; queries shared by both apps go
   in `packages/api`; schema in a migration; secrets and third-party calls in an Edge Function.
   Don't write a second copy of logic that already exists in a package — import it.
3. **Write the plan down** for anything bigger than a one-file fix: which files, which tests, which
   commands will prove it, and what you will not touch. In a multi-agent run, the plan is the list
   of paths you were assigned.

## 2. When to ask, and how

**Ask** when the request has two readings that would lead to materially different code, when the
SPEC and the code disagree and you can't tell which is intended, or when a choice needs human
judgement (product behaviour, UX direction, anything irreversible).

- **One question at a time**, with options and a recommended default so the answer is a quick pick.
- **Play back** the understood requirement in a few lines and wait for a yes before building.
- **Don't ask** about what the repo, the SPEC, an ADR or an earlier answer already settles.

**Skip the questions** only when all three hold: one obvious reading; small and contained (no new
table, route, Edge Function, migration or cross-package change); cheap to redo.

**When nobody can answer** — a subagent, a scheduled run, or the user said "just do it" — list your
assumptions up front, proceed on them, and repeat them in your report / PR body so they can be
corrected. A subagent inherits its parent's brief and does not re-ask the user.

## 3. Do the mechanical work yourself

If you have the tools, do it: run the checks, regenerate types, vendor the engine, fix formatting,
read the `.d.ts` in `node_modules`. Only hand back to the user:

- decisions that need human judgement;
- credentials or secrets you can't access (a new Edge Function secret, an EAS credential);
- approval before a destructive or irreversible action (dropping data, force-push, deleting a
  Supabase project, deploying to prod);
- genuinely ambiguous requirements.

## 4. No silent scope creep

- Change only what the task needs, in the paths you were assigned. Don't reformat, rename or
  "tidy" unrelated code in the same change.
- Found a bug, stale doc or missing test outside your scope? **Report it** (or queue a suggested
  task) — don't fix it silently.
- If the task can't be done without touching something outside scope (a shared type, a migration),
  stop and say so, or do the minimum and call it out explicitly in the report.
- Don't add dependencies casually. If you must, pin to the Expo-bundled version where one exists
  (`node_modules/expo/bundledNativeModules.json`) and say why in the PR.

## 5. Recording deviations

| Situation                                                            | Record it in                                                       |
| -------------------------------------------------------------------- | ------------------------------------------------------------------ |
| You depart from SPEC, or change a SPEC "Decision" row                | New ADR in `docs/decisions/` (never edit `docs/SPEC.md`)           |
| SPEC is silent and you picked a default (coefficient, threshold ...) | New ADR, or a row in the module's existing ADR if it is still open |
| A model's output changes                                             | Bump its `*_VERSION` constant + ADR                                |
| An earlier ADR is wrong                                              | New ADR that supersedes it; mark the old one `Superseded by NNN`   |
| A known gap / TODO left in code                                      | Code comment naming the SPEC section + a line in your report       |
| Assumptions made without an answer                                   | Report / PR body "Assumptions" section                             |

ADR format and numbering: [`docs/decisions/README.md`](../decisions/README.md).

## 6. What "verified" means

You may say **done** only after the checks for your change have **run and passed in this session**.
"Should work", "typechecks in my head" and "tests exist" are not verification. Always run
`pnpm format` last, then `pnpm typecheck && pnpm lint && pnpm test` for any code change. On top of
that:

| Area you touched                | Verified means                                                                                                                                                                                                                                                |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/engine`               | Tests pass at 100 % coverage; invariants have fast-check properties (e.g. normalise → apply is identity); `pnpm vendor:engine` run and the Deno vendor test passes.                                                                                           |
| `packages/api`                  | Unit tests against `testing/fakeDb.ts`; if the function is mirrored in `supabase/functions/_shared/`, the mirror is updated and `deno task test` passes.                                                                                                      |
| `packages/db` (migrations, RLS) | `local-db.sh` applies every migration from empty and the RLS smoke test passes, with a new case for any new table/policy; `db:types` regenerated and committed; downstream `typecheck` passes.                                                                |
| `supabase/functions`            | `deno task test` and `deno task check` pass. If Deno is not available, say so explicitly — CI does not run them.                                                                                                                                              |
| `apps/web`                      | Unit tests for logic in `src/lib`; `pnpm build` with placeholder env passes (catches server/client boundary and route errors). For UI, load the page in `next dev` and exercise it if you can; otherwise say it was not viewed.                               |
| `apps/mobile`                   | Unit tests for `src/features` / `src/lib` logic; `npx expo export --platform android` passes (Metro resolution, no import-time native calls). **Device verification** (dev build on a phone: GPS, map, SQLite, sync) is separate — state whether it was done. |
| `apps/watch`                    | Cannot be built here (no Connect IQ SDK). Keep `lib/garmin/protocol.ts` tests green and say the watch side is unverified.                                                                                                                                     |
| Docs only                       | `pnpm format` (Prettier formats Markdown); links resolve to files that exist.                                                                                                                                                                                 |

**Report honestly:** list what ran, what passed, and what could not be verified (physical device,
production deploy, Connect IQ build, anything needing network). A clear "not verified on device" is
better than an implied yes.

## 7. Commit and PR hygiene

- **Don't commit unless asked.** In orchestrated runs the orchestrator commits; you leave a clean,
  formatted working tree and a report.
- **Branches:** short-lived, off `main`, named `<type>/<short-slug>` (`feat/putt-card`,
  `fix/sync-backoff`). PRs into `main`; nothing is pushed straight to `main`.
- **Commits:** Conventional Commits with a scope matching the package or app —
  `feat(engine):`, `fix(mobile):`, `feat(mobile,api):`, `feat(db):`, `feat(functions):`,
  `docs:`, `chore:`. One logical change per commit; imperative subject under ~72 chars. Add a
  `Co-Authored-By:` trailer when an AI assistant contributed.
- **Never** use `--no-verify`, never force-push a shared branch, never commit secrets or `.env*`
  files (only `.env.example`).
- **PR body** follows [`.github/pull_request_template.md`](../../.github/pull_request_template.md):
  summary, SPEC/ADR references, checks run, device verification, migration/types, assumptions.
  Title under 70 characters.
- **Generated files** (`database.types.ts`, `supabase/functions/_shared/engine/`) are committed in
  the same PR as the change that regenerates them — never edited by hand.

## 8. Handing back

End every task with a short report: what changed (file paths), how it was verified, what was not
verified and why, assumptions made, and anything noticed out of scope. Keep it to what the reader
needs to act on.
