# 003 — Dispersion engine: interpretation choices

Status: accepted (wave 1). Applies to `packages/engine/src/dispersion`, `DISPERSION_ENGINE_VERSION = 1`.

- `n_effective` = summed weights of the player's own good shots; the 8 prior
  pseudo-shots are not counted, so confidence tiers and the ≥ 15 empirical
  threshold refer to real data. `n_raw` counts every source (manual included).
- Lateral is an equal-mass two-piece normal pivoted at `lateral.mean`
  (`sd_left` / `sd_right`); quantiles, ellipse and sampling all use it.
- Variance is taken about the posterior mean (§8.3 literally); no small-sample correction.
- Miss pattern has no prior; with no mishits it is `p_miss = 0`, zero mean/SD.
- `now` defaults to the latest shot's `playedAt` so fitting stays pure.
- Cone: radial extent mean ± k·sd; edge rays through mean ± k·sd_side at the
  mean distance; rho applies to the ellipse only.
- Ellipse polygon includes the two side-switch angles (steps + 2 points) so the
  mean is always inside, even for lopsided, highly correlated patterns.
- Recency weight underflows to 0 for extreme age/half-life ratios; zero-weight
  shots are dropped. Half-lives ≥ 30 days keep weights in (0, 1].
- Prior spread table: the 11–15 band is the spec's 5.5 % / 6.5 % / 8 %; other
  bands are scaled around it. Loft table anchors: 9°→240 yd, 30°→160, 45°→120.
- `conditionBucketKey` lives in `conditions`; dispersion treats `bucketKey` as opaque.
