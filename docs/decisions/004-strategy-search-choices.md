# 004 — Strategy engine: search and classification choices

Status: accepted (wave 2). Applies to `packages/engine/src/strategy`, `STRATEGY_ENGINE_VERSION = 1`.

- **Layup stations:** patterns are full swings, so instead of sweeping along the
  line (§9.3) each layup/tee club gets one station on `lineOfPlay` at its
  conditioned mean distance, with the lateral sweep. Layups are searched only
  when no club reaches 90 % of the pin distance; off the tee every non-putter
  club is compared; elsewhere layup clubs must finish ≥ 40 m short of the pin.
- **Top 5** keeps the best aim per club (five different clubs, not five
  offsets of one club); the baseline "obvious club at the pin" is ranked with
  them so `savedVsBaseline ≥ 0`.
- **Classification precedence:** OB (any feature with penalty `ob`) > water >
  bunker > green > trees/wooded (lie rough, `recovery` baseline, counted as
  hazard) > deep rough > rough > first cut > fairway > hardpan/pine straw;
  default `rough`; cart paths ignored. Water with penalty `none` is treated as
  yellow.
- **Conditioning:** the lie's extra σ (§7.4) is added as noise; the linear
  `applyConditions` map is recovered once per option and applied per sample;
  samples are drawn once per club and reused across aims so aim comparisons
  are not sampling noise.
- **Outputs:** `pPenalty` includes OB; `pHazardByKind` excludes it; the 80 %
  ellipse covers the main pattern only. Snapshots omit the ellipse and record
  strategy/condition/dispersion versions plus an 8-char input hash.
- **Grid:** lateral −44..+44 m at 2 m; default coarse (6 m) → refine ±2/±4 m
  around the two best; `exhaustive: true` tries every offset (tested within
  0.02 strokes of exhaustive). Full approach search ≈ 50 ms in Node.
