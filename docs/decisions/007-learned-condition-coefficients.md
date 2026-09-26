# 007 — Learned condition coefficients

Status: Accepted (unverified against real player data)
Date: 2026-09-26
Scope: SPEC §7.6, §8.6. Code: `packages/engine/src/conditions/learn.ts`,
`supabase/functions/_shared/refit.ts`, `supabase/functions/refit/handler.ts`. Versions:
`CONDITION_MODEL_VERSION` stays 1 (defaults unchanged).

## Context

SPEC §8.6 asks for `k_head`, `k_tail`, `k_cross`, `k_elev` fitted per club kind once ≥ 60 course
shots exist, by weighted least squares on `observed − neutral_mean` with ridge shrinkage towards
the defaults, stored in `profiles.condition_overrides`, and says the fit "bumps the player's model
version". It leaves open the penalty, the handling of the baseline, safety limits, how
per-kind head/tail estimates map onto a model whose head/tail coefficients are single values
(decision 002), and the order of the write / recompute / refit steps.

## Decision

**Regression.** Per kind, residuals against the prediction from the club's current neutral
pattern mean μ with the default coefficients (lie, slope, density, hang from the player's model):

- along: `r = c_a·A + δ_head·(−A·W_h⁺) + δ_tail·(A·W_t⁺) + δ_elev·(−Δh)`, `A = μ_along · lie · (1 + slope)`
- lateral: `r = c_l·μ_along + δ_cross·(μ_along · W_c · hang)`

The δ columns are the exact partial derivatives of the linear model, so the fit is linear.
`c_a` / `c_l` are **free intercepts** (fractional baseline bias): μ was normalised with the previous
coefficients and, without them, its bias leaked into `k_head` / `k_tail` (a first version without
them drifted for 6+ refits; with them it settles in 3). Weights are the §8.2 recency weights.

| Item               | Value                                                                                            | Rationale                                                                                                                 |
| ------------------ | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| Penalty λ_j        | `N₀ · D̃_jj / n_j`, N₀ = 60                                                                       | D̃_jj = information on j after profiling out the intercept; n_j = weighted count of shots with that component ≠ 0          |
| Prior weight       | `N₀ / (N₀ + n_j)` for an unconfounded coefficient: ½ at 60 shots                                 | "60 shots halve the prior"; scale-free, so the same rule serves m/s, metres and every club length (test-verified exactly) |
| No own information | δ pinned to 0, `n = 0`, `se = null`                                                              | All-zero column, or one proportional to the intercept (a steady wind can't be told from a baseline bias)                  |
| Minimum            | 60 usable shots per kind; fewer → defaults untouched                                             | SPEC §8.6                                                                                                                 |
| Exclusions         | non-course, strike ≠ good, penalty, putts, putter, §8.1 reconstructed, wind > 20 m/s, non-finite | `isExcludedShot` reused; gales are more likely bad snapshots and keep the air multiplier far from its floor               |
| Clamp              | every coefficient to [0.3×, 3×] its default                                                      | A bad batch can't flip a sign or produce 10× effects; `clamped` is reported                                               |
| SE                 | `σ̂² (XᵀWX + Λ)⁻¹`, σ̂² from weighted residuals                                                    | Reported per coefficient; the recovery property checks error ≤ 5 SE + prior pull                                          |
| Head/tail override | n-weighted mean of the fitted kinds' `k_head` / `k_tail`                                         | `ConditionModelV1` keeps single head/tail values (decision 002); per-kind estimates are still returned                    |
| Stored precision   | 4 significant digits                                                                             | Stable JSON, so an unchanged fit is detected and triggers nothing                                                         |

**Version.** `resolveConditionModel` fixes `version` and overrides never carry it, so learning does
**not** bump `condition_model_version` (a deviation from §8.6's wording). The player's model is
identified by `CONDITION_MODEL_VERSION` + `profiles.condition_overrides`; a changed override is
detected by comparing the merged JSON with the stored one.

**Order in `refit`** (`learnConditions`, default true on the endpoint, off in `finalise-round` /
`import-sim`): (1) fit every club's neutral pattern in memory for μ, run the fit over all course
shots; (2) deep-merge into the stored override (other keys kept) and, if it changed, **write it
first** — it is the source of truth; (3) re-normalise every course shot with the new model, writing
changed values only; (4) refit the requested clubs plus every club whose shots moved. If a run dies
after (2), `recomputeNeutral: true` repairs it: with overrides present it re-derives every course
shot rather than only those behind the version.

## Alternatives considered

- **No intercept** — simpler, but the baseline bias of μ feeds straight into head/tail and the
  refit converges slowly (measured: still moving after 6 runs).
- **Data-relative λ = N₀·D_jj/Σw** — counts calm shots as informative about wind, so one shot in
  0.1 m/s of tailwind among 100 calm ones would already weaken the prior to ⅜.
- **Fixed-scale λ from a "typical" 3 m/s shot** — depends on club length and units; the halving
  point would not be 60 shots.
- **Pooled head/tail regression across kinds** — the task asks for per-kind estimates; pooling
  afterwards keeps them visible and still yields one model value.

## Consequences

- Recovery on synthetic 7-iron shots (true 1.5× head, 0.6× tail, 1.4× cross, 0.7× elev; 5 %
  along / 6 % lateral noise; winds 0–10 m/s; ±15 m rises; 50 seeds), mean |error| as a fraction of
  the default:

  | n    | head  | tail  | cross | elev  |
  | ---- | ----- | ----- | ----- | ----- |
  | 60   | 0.365 | 0.377 | 0.195 | 0.148 |
  | 240  | 0.202 | 0.245 | 0.086 | 0.061 |
  | 960  | 0.071 | 0.094 | 0.035 | 0.028 |
  | 3840 | 0.021 | 0.033 | 0.018 | 0.014 |

  Most of the error at small n is the intended pull towards the defaults. Shrinking one
  coefficient leaks slightly into the other through the intercept (seen in the refit fixed point:
  true tail 0.011 settles at ≈ 0.013 with 600 shots); it vanishes as n grows.

- The device still normalises with the default model: `@caddymate/api` / mobile do not read
  `profiles.condition_overrides` yet, so shots written after an override are only brought in line
  at the next override change or `recomputeNeutral: true`. The server recompute uses snapshot
  elevations, not the course grid (as the existing `recomputeNeutral` does).
- Verified by engine unit + fast-check properties (recovery, no-signal, clamps, exact ½ prior
  weight at 60 shots; 100 % coverage) and Deno handler tests on the fake store (order, merge,
  opt-out, fixed point). Not verified on real rounds or against a deployed database.
