# 002 — Condition model: defaults the spec left open

Status: accepted (wave 1). Applies to `packages/engine/src/conditions`, `CONDITION_MODEL_VERSION = 1`.

## Form of the model

Conditioned along = neutral along × lieFactor × (1 + slope) × (1 + wind + density) + elevationEffect.
Conditioned lateral = neutral lateral + neutral along × (crosswindDrift + slopeBias).

The linear form is what makes `normaliseShot` and `applyConditions` exact inverses
(property-tested to 1e-9). The `breakdown` entries are built in the order
lie → slope → wind/density → elevation and sum exactly to the totals.

## Values chosen where SPEC §7 gave none

| Coefficient        | Value                                                             | Rationale                                                                                              |
| ------------------ | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `k_cross`          | 0.012 per m/s (0 for putter)                                      | ≈ 8 m drift for a 150 m 7-iron in a 10 mph crosswind                                                   |
| `hang` per kind    | driver 0.6, wood 0.7, hybrid 0.85, iron 1.0, wedge 1.25, putter 0 | More loft → more time aloft → more drift; a loft curve is interpolated instead when `loftDeg` is known |
| `k_elev` hybrid    | 0.8                                                               | Midway between woods (0.7) and irons (0.9)                                                             |
| `green` lie row    | all neutral                                                       | `Lie` includes `green`; putts are not normalised                                                       |
| `minAirMultiplier` | 0.05                                                              | A > 45 m/s headwind must not zero the multiplier and break normalisation                               |
| Missing/NaN wind   | calm bin                                                          | `conditionBucketKey` always returns a key                                                              |

Head/tail wind coefficients stay single values (not per kind) as §7.1 states; only
crosswind drift is kind-dependent. Multiple slope toggles add.

"Plays like" = (D − elevationEffect) ÷ (wind/density multiplier): the neutral
distance the player must produce to finish at D.
