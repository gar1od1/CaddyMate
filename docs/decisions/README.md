# Architecture decision records

Short records of choices that deviate from, amend, or fill gaps in [`docs/SPEC.md`](../SPEC.md).
The SPEC is never edited to reflect a decision; the ADR is the record, and code comments cite it
(`decision 005`, `ADR 003`).

## Index

| #                                               | Title                                    | Status   | Summary                                                                                                                                                                                                              |
| ----------------------------------------------- | ---------------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [001](001-watch-protocol.md)                    | Phone ↔ watch protocol                   | Accepted | Phone sends one display-ready `state`; watch sends `hello`/`mark`/`holed`/`club` events with its own fix; the watch never computes strategy. Unverified on hardware.                                                 |
| [002](002-condition-model-defaults.md)          | Condition model defaults                 | Accepted | Linear model so normalise/apply are exact inverses; picks crosswind, hang-time, elevation and air-floor coefficients the SPEC left open (`CONDITION_MODEL_VERSION = 1`).                                             |
| [003](003-dispersion-fit-choices.md)            | Dispersion engine interpretation choices | Accepted | `n_effective` excludes prior pseudo-shots; two-piece lateral normal; cone/ellipse construction; prior spread and loft anchors (`DISPERSION_ENGINE_VERSION = 1`).                                                     |
| [004](004-strategy-search-choices.md)           | Strategy search and classification       | Accepted | One layup station per club, top 5 = best aim per club, landing-classification precedence, coarse→refine lateral grid (`STRATEGY_ENGINE_VERSION = 1`).                                                                |
| [005](005-on-device-normalisation-and-refit.md) | On-device normalisation and refit        | Accepted | Client writes neutral values and pattern rows with the same pure engine code; server `refit` stays authoritative; handicap basis for net/Stableford. Amends SPEC §6.4, §8.8.                                         |
| [006](006-roles-and-curator.md)                 | Roles: player, curator, admin            | Accepted | One role per user; `curator` = player + `courses.publish`; `admin` holds every key; roles only widen ownership RLS; no tenants yet.                                                                                  |
| [007](007-learned-condition-coefficients.md)    | Learned condition coefficients           | Accepted | §8.6: per-kind weighted ridge fit of `k_head`/`k_tail`/`k_cross`/`k_elev` with free intercepts, prior worth 60 shots, 0.3×–3× clamps; `refit` writes the override, then re-normalises, then refits. No version bump. |
| [008](008-deploy-and-observability.md)          | Deploy automation and observability      | Accepted | Supabase deploy after green CI on `main`, gated on secrets + opt-in variable; Vercel config; EAS build on `mobile-v*` tags; DSN-gated Sentry on mobile, web and Edge Functions (id-only users).                      |

## When an ADR is required

Write one, in the same change as the code, when you:

- deviate from the SPEC or change one of its "Decision" rows (§3.1 stack, schema, model form ...);
- choose a value or behaviour the SPEC left open (coefficients, thresholds, precedence, defaults);
- change a model's output and bump its `*_VERSION` constant;
- change a contract between runtimes (watch protocol, Edge Function request/response, sync semantics);
- add a dependency that changes the architecture (new native module, new external service);
- supersede an earlier ADR.

Not needed for: bug fixes that bring code in line with the SPEC, refactors with no behaviour change,
UI copy, tests.

## Rules

- **Numbering:** three digits, next free number after the highest existing file
  (`006-<kebab-slug>.md`). Numbers are never reused, even if an ADR is withdrawn. `000` is the
  template.
- **Start from** [`000-template.md`](000-template.md). Keep it short — a page is plenty.
- **Status:** `Proposed` → `Accepted` → optionally `Superseded by NNN`. Add the scope of
  verification if it matters (e.g. "unverified on hardware").
- **Immutability:** accepted ADRs are not rewritten. To change a decision, write a new ADR and set
  the old one's status line to `Superseded by NNN` (the only edit allowed).
- **Index:** add a row to the table above in the same change.
- **Cross-reference:** name the SPEC sections and code paths the ADR applies to.
