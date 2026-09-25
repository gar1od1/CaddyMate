# CaddyMate v2 — Product & Technical Specification

Status: **draft v0.1** — 25 Sep 2026. Written from the discovery interview; every
"Decision" below is a recommendation that can be overturned before Phase 0 starts.

---

## 0. One-paragraph summary

CaddyMate is a shot-dispersion and course-strategy app for a single golfer
(initially), built so it can become a consumer SaaS later. On the course it
records every shot from GPS, with the player supplying club, lie, stance slope and
intended line. Off the course it ingests simulator shots (Square Golf / GSPro).
From all of that it maintains one **neutral dispersion pattern per club**,
stripping out wind, slope, lie, elevation and air density on the way in and
re-applying the live conditions on the way out, so the map always shows a
condition-correct cone (or ellipse on approach). A DECADE-style strategy engine
uses the pattern plus course geometry to recommend an aim point and club that
minimise expected strokes, records the recommendation, and after the round grades
every decision (strategy loss vs. execution loss) alongside strokes-gained stats,
a Stableford scorecard and a locally computed WHS handicap. A Garmin Vivoactive 5
companion app mirrors the essentials on the wrist.

The reference to beat is **Shot Pattern** (iOS): same core idea, but CaddyMate
adds real historic shot data, condition normalisation, left/right bias, course
geometry, strategy recommendations and decision grading.

---

## 1. Goals, non-goals, success criteria

### 1.1 Goals
1. Know my true dispersion per club, per condition, from real data.
2. Stop making stupid decisions: get told the right aim + club, then be shown
   afterwards which strokes I lost to strategy vs. execution.
3. Be usable every Saturday at Moyvalley from the first phase onward.
4. Single-user now; data model, auth and billing hooks ready for a paid
   multi-user product later.

### 1.2 Non-goals (v1)
- Carry vs. total split from on-course GPS (total only; sim provides carry).
- Offline play (a data signal is assumed on the course).
- Data export, social features, sharing rounds, leaderboards.
- Practice/range drill mode (parked; schema allows it).
- Automatic shot detection (every shot is a deliberate tap on phone or watch).
- Official handicap submission to Golf Ireland (index is computed locally for
  display; the player's official index can be typed in and overrides).

### 1.3 Success criteria for "finished v1"
- 20+ rounds logged at Moyvalley without data loss or needing to edit more than
  one shot per round.
- Every club with ≥ 30 effective shots shows an ellipse that visibly matches
  where the ball actually goes (checked in round replay).
- The post-round review states strategy loss and execution loss per round and
  per club; strokes gained per category matches an independent calculation
  from the same shots.
- Handicap index computed by the app agrees with Golf Ireland's to within 0.2
  for rounds both have seen.
- Watch app can mark a ball position and show distance + recommended club
  without touching the phone.

---

## 2. The player (persona and priors)

| Item | Value |
|---|---|
| Handicap index | 13 (target: single figures) |
| Home course | Moyvalley GC, Ireland — white tees, ~6,500 yds |
| Units | Yards on screen; SI (metres) in storage and engine |
| Handedness / shape | Right-handed, natural draw |
| Bag | Driver 9°, 5-wood, 4-hybrid, P790 irons 5–PW, wedges 50/54/60, putter |
| Stated stock distances | Driver 240, 7i 160, PW 120 (yards) |
| Launch monitor / sim | Square Golf Home Edition + GSPro |
| Watch | Garmin Vivoactive 5 |
| Phone | Android (iOS required too) |
| Signal on course | Assumed available |

Handedness is stored per user because slope/lateral bias rules flip for
left-handers.

---

## 3. Platforms and architecture

### 3.1 Decision: stack

| Layer | Choice | Why |
|---|---|---|
| Monorepo | `pnpm` workspaces + Turborepo | One TypeScript codebase; engine shared by mobile, web and edge functions |
| Mobile | **Expo (React Native)**, TypeScript, `expo-router`, EAS Build | Android + iOS from one codebase; cloud builds so no Mac is required; OTA updates for fast iteration while playing weekly |
| Web | **Next.js** (App Router) on Vercel | Sim CSV import, course editor, round review dashboard; reuse of the existing Vercel project |
| Engine | `packages/engine` — pure TS, zero React/RN deps | Geo maths, condition model, dispersion fitting, strategy, strokes gained, WHS/Stableford. Runs in the app, on the web and in Supabase Edge Functions (Deno) unchanged |
| Backend | **Supabase** (Postgres 17 + PostGIS, Auth, Storage, Edge Functions) | Already owned; RLS gives multi-tenancy for free |
| Maps | **MapLibre GL** (`@maplibre/maplibre-react-native`, `maplibre-gl` on web) with satellite raster tiles | Open, no per-SDK lock-in; same style JSON on both surfaces |
| Satellite imagery | Mapbox Satellite raster tiles (free tier is ample for one user); ESRI World Imagery as fallback | Best imagery of Irish courses in practice |
| Elevation | Mapbox Terrain-RGB tiles decoded in the engine (cached per course) | 1 tile fetch per course, then everything is local; gives slope grids for stance suggestion |
| Weather | **Open-Meteo** (free, no key): 10 m wind speed/direction, gusts, temperature, surface pressure | Fetched once per hole (or on demand); stored as a snapshot on every shot |
| Watch | Garmin **Connect IQ** app in Monkey C, talking to the phone via the Connect IQ Mobile SDK | Only route onto a Garmin; sideload to own watch, store later |
| CI/CD | GitHub Actions (typecheck, lint, unit tests, engine property tests); Vercel preview per PR; EAS Build on tag | Protects `main`; single dev keeps PR flow light |

Rejected alternatives: Flutter (would split the engine from the web app's
TypeScript), Google Maps SDK (per-platform APIs, poor satellite tile reuse in a
custom style), native Kotlin + Swift (two codebases for one person).

### 3.2 Repository layout

```
apps/
  mobile/          Expo app (Android + iOS)
  web/             Next.js: sim import, course editor, review dashboard
  watch/           Garmin Connect IQ app (Monkey C; built with the Garmin SDK, not pnpm)
packages/
  engine/          pure-TS golf maths (see §6–§9); 100% unit-tested
  db/              Supabase migrations, generated types, RLS policies, seed scripts
  api/             typed data-access layer over supabase-js used by mobile + web
  ui/              shared design tokens (colours, spacing, type scale) — RN + web
supabase/
  functions/       Edge Functions (pattern refit, import processing, SG batch)
docs/
  SPEC.md          this file
  decisions/       ADRs for any change to the "Decision" rows above
```

### 3.3 Environments
- **Local dev:** Supabase CLI (`supabase start`) with migrations from
  `packages/db`; Expo dev client on a physical Android phone.
- **Prod:** `caddymate-prod` (`mceverccxohligbwpdwd`, eu-west-1). The paused
  `caddymate-staging` project is not needed; delete it once v2 has its first
  migration applied to prod.
- **Branching:** short-lived branches → PR → `main`. `main` deploys web to Vercel
  and applies migrations to prod via CI. Mobile builds are cut from tags.

### 3.4 Multi-tenancy from day one
- Every user-owned table has `user_id uuid not null references auth.users`.
- RLS: owner-only read/write on user data; courses are readable by all
  authenticated users and writable by their `created_by_user_id` (admin role
  later for curation).
- `profiles.plan` enum (`free`, `pro`) exists but is unused; billing tables are
  **not** created until needed (avoid carrying dead Stripe code from v1).
- All engine functions are pure and take a `PlayerProfile` argument — no global
  state, so the same code serves N users.

---

## 4. Core concepts and vocabulary

| Term | Meaning |
|---|---|
| **Shot** | One stroke. Has a start position, an end position, a club, conditions and intent. Sim shots have no positions, only measured carry/total/offline. |
| **Chain** | Within a hole, shot *n*'s end position is shot *n+1*'s start position. Holing out ends the chain. |
| **Intended line** | The direction the player meant to start the ball on. Defined either by a target point tapped on the map or by a feature-relative offset ("10 yds right of the left fairway bunker"). Stored as a target point plus the resolved bearing. |
| **Club frame** | 2-D frame with origin at the start position, +y along the intended line, +x to the player's right. Every shot result becomes `(distance_along, lateral_offset)` in this frame. |
| **Observed result** | The club-frame result as it happened, conditions included. |
| **Neutral result** | The observed result with the condition model's predicted effects subtracted: what the shot would have done on a flat, windless, sea-level, 20 °C fairway. |
| **Neutral pattern** | Per club: the distribution of neutral results, estimated from recency-weighted shots with a prior. |
| **Conditioned pattern** | The neutral pattern with current conditions re-applied — what's drawn on the map. |
| **Miss pattern** | Per club: the distribution of shots tagged fat/thin/shank/top. Excluded from the neutral pattern; used by strategy as the "disaster" mixture component. |
| **Cone / arc** | The conditioned pattern drawn from the current position: a skewed sector bounded by lateral quantiles at the distance quantiles. Used for tee shots and layups. |
| **Ellipse** | The conditioned pattern drawn around the aim point as 1σ / 80 % / 95 % ellipses. Used when the shot is at a green. |
| **Recommendation** | Strategy engine output for a position: ranked (club, aim point) options with expected strokes and outcome probabilities. Snapshotted onto the shot. |
| **Strategy loss** | Expected strokes of the player's chosen (club, aim) minus expected strokes of the best option. |
| **Execution loss** | Actual strokes-gained of the shot minus the expected strokes-gained of the chosen (club, aim). |

---

## 5. On-course flow (mobile + watch)

### 5.1 Starting a round
1. Pick course (Moyvalley), tee set (white), date/time defaults to now.
2. App fetches weather for the course centroid and the elevation grid (cached).
3. Pin position = green centroid for every hole (v1). Editable per hole by
   tapping the green; stored on the round, not the course.
4. Hole 1 opens in **Play view**.

### 5.2 Play view (per hole)
- Satellite map, north-up by default, "line-up" mode rotates the map so the
  intended line points up.
- Distances: to pin (front/centre/back of green), to every hazard edge along
  the current line, to the recommended landing zone.
- Overlay: the conditioned cone/ellipse for the selected club from the current
  ball position.
- Bottom sheet (thumb-reachable): the **pre-shot card**.

### 5.3 Pre-shot card (entered before the shot)
| Field | Input | Default |
|---|---|---|
| Club | Horizontal chip picker, ordered by bag | Strategy recommendation, else last-used for similar distance |
| Lie | `tee, fairway, first_cut, rough, deep_rough, sand, hardpan, pine_straw` | Inferred from the surface polygon under the GPS position, else fairway; tee on stroke 1 |
| Stance slope | Four toggles: uphill, downhill, ball above feet, ball below feet; each `mild` or `severe` | Suggested from the elevation grid at the ball position (see §7.5); shown as "suggested", one tap confirms |
| Intended line | (a) tap a target point on the map, or (b) feature-relative: pick a feature (bunker, tree, green edge, pin) and an offset in yards left/right/short/long of it | Strategy recommendation's aim point |
| Shape | `straight, draw, fade` (optional) | Player's default shape |
| Wind | Read-only display (speed, direction, head/tail and cross components along the intended line) with a manual override | API |

Tapping **Hit** (phone) or the equivalent watch button records `start_position`
from GPS, `start_accuracy_m`, timestamp and everything on the card.

### 5.4 Post-shot
- Walk to the ball. Tapping **Ball here** (phone or watch) records
  `end_position` and opens the next pre-shot card with the chain already advanced.
- Optional strike quality chips on the previous shot: `good, fat, thin, toe,
  heel, top, shank`. Anything other than `good` moves the shot to the miss
  pattern.
- Result surface, distance from pin and whether it's in a hazard/OB are derived
  from `end_position` against course geometry; no manual entry.
- Penalties: if `end_position` is inside a penalty area or OB, the app offers the
  relief options (drop point along the line, previous spot, lateral) and records
  a `penalty` shot record with `strokes = 1`, so the chain stays correct.
- **Holed:** tapping "Holed" ends the hole; `end_position` = pin.

### 5.5 Putting
- On the green, distance to the pin is taken from GPS but green-size GPS error
  (±3 m) is too big for putts. The pre-shot card switches to a **putt card**:
  distance is entered/adjusted with a stepper in feet (pre-filled from GPS),
  and result is `holed` / `left short` / `past` with a feet stepper for the
  remaining distance. Uphill/downhill/breaking flags are optional.
- Putts are shots with `club = putter`, `lie = green`; they feed the putting
  strokes-gained category and putt counts on the scorecard.

### 5.6 Editing and reconstruction
- Every shot on the hole is listed under the map; tapping opens it for editing
  (drag start/end markers, change club/lie/slope, delete, insert before/after).
- If the player forgets **Hit** and only taps **Ball here**, the app creates the
  shot with `start_position` = previous shot's `end_position` and flags it
  `reconstructed: true` for review. The pre-shot fields are asked for
  retrospectively (they default to the recommendation).
- Editing a shot triggers re-derivation of everything downstream (chain,
  neutral result, SG, grades) via a single `recomputeHole()`.

### 5.7 Scorecard
- Hole strokes = count of shot records on the hole including penalties; can be
  overridden (with a reason) if a shot wasn't logged.
- Live gross, net, Stableford points, and to-par; front/back/total.
- End of round: adjusted gross (net double bogey cap), score differential, and
  the provisional new index (§9).

### 5.8 Watch (Phase D) — see §11.

---

## 6. Data model (Postgres/PostGIS)

All geometry is `geography(Point/Polygon/LineString, 4326)`. Distances in metres.
Timestamps `timestamptz`. Every user table carries `user_id`, `created_at`,
`updated_at`. Only the essentials are listed; audit columns omitted.

### 6.1 Identity and equipment
```
profiles           user_id PK, display_name, handedness ('R'|'L'), units ('yd'),
                   handicap_index_official numeric null, default_shape,
                   plan ('free'|'pro'), home_course_id
clubs              club_id PK, user_id, name ('7i'), kind (driver|wood|hybrid|
                   iron|wedge|putter), loft_deg, bag_order, active bool,
                   stock_total_m, stock_carry_m (user-entered priors),
                   sim_name_aliases text[]   -- names GSPro/Square use for it
```

### 6.2 Course model
```
courses            course_id PK, name, slug, country, centroid, boundary_polygon,
                   source (osm|editor|igolf), osm_relation_id, status
                   (draft|published), current_version, created_by_user_id
course_versions    (course_id, version) PK, change_reason, created_at
holes              hole_id PK, course_id, version, hole_number, par,
                   line_of_play LineString (tee → landing zones → green centre),
                   green_polygon, green_centre Point
hole_features      feature_id PK, hole_id, kind (fairway|first_cut|rough|
                   deep_rough|bunker|water|ob|hardpan|pine_straw|tree|
                   wooded|cart_path), penalty (none|lateral|yellow|ob),
                   polygon, notes
tee_sets           tee_set_id PK, course_id, version, name ('White'), colour,
                   course_rating, slope_rating, bogey_rating, par
tee_markers        tee_id PK, tee_set_id, hole_id, marker_point, stroke_index,
                   yardage_m
elevation_grids    (course_id, version) PK, bbox, resolution_m, storage_path
                   (Float32 raster in Supabase Storage), min/max
```

`hole_features` replaces v1's dozen typed tables; the kind enum is the source of
truth for lie inference and penalty logic. Trees are stored as points with a
`radius_m` and `height_m` in `notes`-adjacent columns (`tree_radius_m`,
`tree_height_m`) for the obstacle model.

### 6.3 Rounds and shots
```
rounds             round_id PK, user_id, course_id, course_version, tee_set_id,
                   started_at, finished_at, status (live|complete|abandoned),
                   weather_snapshot jsonb (first fetch), pin_overrides jsonb,
                   gross, adjusted_gross, stableford, differential
hole_scores        (round_id, hole_number) PK, strokes_logged, strokes_override,
                   override_reason, putts, penalties, points, net_strokes
shots              shot_id PK, user_id, round_id null, hole_number null,
                   seq int,                        -- order within hole
                   source (course|sim|manual),
                   club_id, played_at,
                   -- geometry (course shots)
                   start_position Point, start_accuracy_m, end_position Point,
                   end_accuracy_m, holed bool, reconstructed bool,
                   -- intent
                   target_point Point, target_bearing_deg, target_ref jsonb
                   (feature-relative definition), intended_shape,
                   -- inputs
                   lie, slope_up ('none'|'mild'|'severe'), slope_down, slope_above,
                   slope_below, slope_suggested jsonb, strike (good|fat|thin|toe|
                   heel|top|shank), penalty (none|lateral|yellow|ob|unplayable),
                   stroke_count int default 1,   -- 2 for stroke-and-distance
                   -- conditions snapshot
                   conditions jsonb  { wind_speed_ms, wind_dir_deg, gust_ms,
                     temp_c, pressure_hpa, elevation_start_m, elevation_end_m,
                     wind_head_ms, wind_cross_ms, override:bool }
                   -- derived (rewritten by recomputeHole)
                   observed_distance_m, observed_lateral_m,
                   neutral_distance_m, neutral_lateral_m,
                   condition_model_version int,
                   result_surface, distance_to_pin_before_m, distance_to_pin_after_m,
                   -- sim fields
                   sim_carry_m, sim_total_m, sim_offline_m, sim_session_id,
                   -- strategy snapshot
                   recommendation jsonb (top-N options, chosen option, engine version),
                   -- grades
                   sg numeric, sg_category (ott|app|arg|putt),
                   strategy_loss numeric, execution_loss numeric,
                   decision_grade (good|poor), execution_grade (good|poor)
sim_sessions       session_id PK, user_id, imported_at, source (gspro|square),
                   file_hash (dedupe), row_count, ball_type, notes
club_patterns      (user_id, club_id) PK, params jsonb (see §8.4), n_effective,
                   n_raw, confidence (seeded|forming|established), fitted_at,
                   engine_version
club_condition_patterns (user_id, club_id, bucket_key) PK, params jsonb,
                   n_effective   -- empirical dispersion per condition bucket
sg_baselines       (baseline_id, category, distance_m) PK, expected_strokes —
                   published tables (scratch, 10, 15, 20 hcp) + 'self'
weather_cache      (lat_r, lon_r, hour) PK, payload jsonb
devices            device_id PK, user_id, kind (garmin_ciq), watch_model,
                   last_seen_at
```

### 6.4 Invariants
- For course shots, `start_position` of `seq n+1` equals `end_position` of
  `seq n` (enforced in `recomputeHole`, not by a DB constraint, so edits can be
  applied atomically).
- `neutral_*` fields are never written by the client directly; they're produced
  by the engine's `normaliseShot()` and stamped with `condition_model_version`
  so a future model change can recompute all history.
- `recommendation` is immutable once written: it's what the player saw.

---

## 7. Condition model (`packages/engine/conditions`)

Purpose: a deterministic, versioned function

```
effects = predictEffects(clubProfile, intendedLine, conditions, lie, slope)
neutral = observed − effects            (normalise, on the way in)
conditioned = neutral + effects'        (re-apply, on the way out)
```

All coefficients live in a single `ConditionModelV1` object with per-club-kind
defaults; every coefficient is a candidate for later fitting from the player's
own residuals (§8.6). Units inside the engine: metres, m/s, °C, hPa.

### 7.1 Wind
Wind vector decomposed along the intended line into head component `W_h` (+ into
the player) and cross component `W_c` (+ from the player's left, pushing the ball
right).

- Distance: `Δd = −d · (k_head · W_h)` for `W_h > 0`; `Δd = −d · (k_tail · W_h)`
  for `W_h < 0`, with `k_tail < k_head` (tailwind helps less than headwind hurts).
  Defaults: `k_head = 0.021 /(m/s)` (~1 % per mph), `k_tail = 0.011 /(m/s)`.
- Lateral: `Δx = k_cross(kind) · W_c · d · hang(kind)`; `hang` grows with loft
  (wedges drift more per unit distance than a driver).
- Gusts are stored but not applied (single speed+direction per the interview).
- Manual override sets `conditions.override = true` and replaces speed/direction.

### 7.2 Elevation change
`Δh = elevation(end or target) − elevation(start)`.
`Δd = −k_elev(kind) · Δh`, default `k_elev` 0.9 for irons, 0.7 for woods/driver,
1.0 for wedges (steeper descent → closer to 1 : 1). Applied to the plays-like
distance shown to the player and to normalisation.

### 7.3 Temperature and air density
Relative air density `ρ/ρ₀` from pressure and temperature vs. 1013 hPa / 20 °C.
`Δd = d · k_density · (1 − ρ/ρ₀)`, default `k_density = 0.55` (a 3 % density
drop ≈ +1.6 % distance). Temperature's ball-compression effect is folded into
this coefficient rather than modelled separately.

### 7.4 Lie
| Lie | Distance factor | Extra lateral σ (m) | Extra distance σ (m) | Flyer prob. |
|---|---|---|---|---|
| tee | 1.00 | 0 | 0 | 0 |
| fairway | 1.00 | 0 | 0 | 0 |
| first_cut | 0.98 | 1.0 | 2 | 0.05 |
| rough | 0.93 | 3.0 | 6 | 0.15 |
| deep_rough | 0.80 | 6.0 | 12 | 0.05 |
| sand (fairway bunker) | 0.90 | 3.0 | 8 | 0 |
| hardpan | 1.00 | 2.0 | 4 | 0 |
| pine_straw | 0.97 | 2.0 | 4 | 0.05 |

Distance factor divides out on the way in; extra σ is *not* normalised away —
it's condition-specific variance that is added back only when re-applying.
"Flyer" is represented in strategy as a mixture component (+8 % distance).

### 7.5 Stance slope
Terrain suggestion: from the elevation grid, sample a 3 m plane fit around the
ball position; project the gradient onto the intended line (uphill/downhill) and
its normal (ball above/below feet). Thresholds: `|grade| < 2 %` → none,
`2–6 %` → mild, `> 6 %` → severe. The player confirms or overrides.

Effects (right-hander; mirrored for left):
| Toggle | Distance | Lateral bias (per 100 m of shot) |
|---|---|---|
| uphill mild / severe | −3 % / −7 % | +0 / −1 m (slight pull) |
| downhill mild / severe | +2 % / +4 % (lower, runs) | +1 / +2 m (slight push) |
| ball above feet mild / severe | −1 % / −3 % | −4 / −9 m (draws left) |
| ball below feet mild / severe | −1 % / −3 % | +4 / +9 m (fades right) |

### 7.6 Model versioning
`condition_model_version` on every shot. Changing any coefficient bumps the
version and triggers a background recompute of `neutral_*` for all shots, then
a pattern refit. Old snapshots on the map (`recommendation`) are not recomputed.

---

## 8. Dispersion engine (`packages/engine/dispersion`)

### 8.1 Inputs per shot
`(neutral_distance, neutral_lateral, weight, source, strike, conditions_bucket)`.

- Course shots: from `end_position` in the club frame, normalised (§7).
- Sim shots: `neutral_distance = sim_total` (with `sim_carry` kept for a future
  carry model), `neutral_lateral = sim_offline`; no normalisation needed.
- Decision: **sim and course shots carry equal base weight** (per interview).
  A `source_weight` multiplier exists (default 1.0 for both) so this can change
  without a schema change.
- Shots with `strike ≠ good` go to the **miss pattern** and are excluded here.
- Penalty/relief records, putts and reconstructed shots with `end_accuracy_m
  > 15` are excluded.

### 8.2 Recency weighting
`w = source_weight · 0.5^(age_days / H)` with half-life `H = 180 days`. A shot
from a year ago counts a quarter of a shot from today. `H` is a profile setting
(a player rebuilding their swing can shorten it).

### 8.3 Prior (cold start)
Each club starts with a prior expressed as pseudo-observations:
- `n₀ = 8` effective shots.
- Prior mean distance: `stock_total_m` if the player entered one, else a
  loft-based table scaled by the driver distance.
- Prior σ_distance = 5.5 % of mean distance; prior σ_lateral = 6.5 % of mean
  distance for irons, 8 % for driver/woods (13-handicap defaults; a table keyed
  by handicap band is used for other users).
- Prior lateral mean = 0 (bias is learned only from data).

Posterior moments are weighted combinations: `μ = (n₀μ₀ + Σwᵢxᵢ)/(n₀ + Σwᵢ)`,
likewise for variance with the prior contributing `n₀σ₀²`. This is the standard
conjugate-normal shortcut and is deliberately simple: transparent to explain in
the UI ("8 seeded shots + 23 of yours").

### 8.4 Pattern parameters (`club_patterns.params`)
```
{
  distance: { mean, sd, q10, q50, q90 },
  lateral:  { mean,               -- bias (+ right)
              sd_left, sd_right,  -- half-SDs measured from the mean
              q10, q50, q90 },
  rho: correlation(distance, lateral),
  n_effective, n_raw, n_sim, n_course,
  miss: { p_miss, distance: {mean, sd}, lateral: {mean, sd} },
  confidence: 'seeded' | 'forming' | 'established'
}
```
- **Left/right bias**: `lateral.mean` shifts the cone; **asymmetric width**:
  `sd_left` / `sd_right` are computed separately from the shots on each side of
  the mean (each half-SD uses its own side's squared deviations, doubled). The
  cone is therefore wider on the big-miss side, which was a hard requirement.
- Quantiles are weighted empirical quantiles when `n_effective ≥ 15`, else from
  the normal parameters.
- `confidence`: `< 12` seeded, `12–30` forming, `> 30` established. The UI
  draws seeded/forming cones with a dashed edge and shows the counts.

### 8.5 Condition-matched patterns
Bucket key = `lie × head-wind bin (−∞,−4],(−4,−1],(−1,1],(1,4],(4,∞) m/s ×
cross-wind bin (same edges)`. For each `(club, bucket)` with `n_effective ≥ 15`,
store the **empirical** observed (not neutral) dispersion. On the course, if the
current conditions fall in a bucket with an established pattern, the map draws
that empirical pattern and labels it "from 23 similar shots"; otherwise it draws
the modelled re-application and labels it "estimated". This gives the
"real history when we have it, estimate when we don't" behaviour requested.

### 8.6 Learning the condition coefficients (Phase B+)
Once ≥ 60 course shots exist for a club kind, fit `k_head, k_tail, k_cross,
k_elev` by weighted least squares on the residual `observed − neutral_mean`
against the condition components. Shrink towards the defaults (ridge) so a
handful of shots can't produce nonsense. Fitted coefficients live in
`profiles.condition_overrides` and bump the player's model version.

### 8.7 Rendering
- **Cone**: from the ball, draw the region bounded by lateral `q10/q90`
  (skewed by bias and half-SDs) at distances `q10 … q90`, as a filled sector
  with a darker core at 1σ. Extends beyond the map edge when zoomed in.
- **Ellipse**: when the selected club's mean distance reaches the green (or the
  target point is on the green), switch to 1σ / 80 % / 95 % ellipses centred on
  the conditioned mean around the aim point, rotated to the intended line. 80 %
  and 95 % scale factors for a bivariate normal are 1.794σ and 2.448σ.
- **Miss pattern**: rendered as a faint second blob only in the review view, not
  live (too noisy on course); strategy uses it numerically.

### 8.8 Refit trigger
Patterns refit incrementally on the device after every shot (cheap: weighted
moments) and authoritatively by an Edge Function after each round/import; the
Edge Function result wins.

---

## 9. Strategy engine — DECADE (`packages/engine/strategy`)

### 9.1 Expected-strokes model
`E(lie, distance_to_hole)` from `sg_baselines`: published amateur tables (scratch
/ 10 / 15 / 20 handicap bands, tee/fairway/rough/sand/recovery/green) with linear
interpolation. Player-specific tables (`baseline = 'self'`) replace band tables
per category once the player has ≥ 40 shots in that category+distance band.
Penalty areas: `E = E(drop lie, drop distance) + 1`; OB: `E(start lie, start
distance) + 1` (stroke and distance).

### 9.2 Evaluating one option
For a candidate `(club, aim_point)`:
1. Build the conditioned pattern for that club along the aim bearing (§7, §8),
   as a mixture: `(1 − p_miss) · main + p_miss · miss` plus the lie's flyer
   component if any.
2. Sample `N = 400` landing points (quasi-random, seeded so results are
   reproducible) or, for tee shots, integrate on a 2 m grid.
3. Classify each point against `hole_features`/green/OB and trees (point in
   polygon; tree hit = within radius along the flight line with height check
   skipped in v1).
4. `E_option = mean over samples of E(landing lie, distance to pin) + penalties`.
5. Also produce: `P(fairway)`, `P(green)`, `P(hazard by kind)`, `P(OB)`,
   expected distance left, and the 80 % ellipse for display.

### 9.3 Search
- **Clubs**: all active clubs whose conditioned mean distance is between 60 %
  and 110 % of the distance to the pin for approaches; every club for tee shots
  and layups.
- **Aim points**: lateral offsets from the pin line at 2 m steps over ±45 m; for
  layups, distances from 40 m short of the pin down to 60 % of the hole length
  along the line of play, at 5 m steps, each with the same lateral sweep.
- Rank options by `E_option`; return top 5 plus the "aim at the pin with the
  obvious club" baseline so the UI can say "this saves 0.15 vs. going at it".
- Tee shots explicitly compare driver vs. 5-wood vs. hybrid by `E_option`
  (which naturally captures "widest safe landing zone").
- Budget: < 150 ms on a mid-range Android for a full approach search
  (400 samples × ~40 aim points × ~4 clubs = 64 k point-in-polygon tests on
  pre-simplified polygons with bbox pre-checks). Tee shots may take ~400 ms and
  are computed while the player walks to the tee.

### 9.4 What the player sees
- Recommended club + aim: "**7i — aim 9 yds left of pin**. 61 % green, 9 %
  bunker, 0.19 strokes better than at the pin."
- One tap accepts (fills the pre-shot card); the player can drag the aim or
  change club and the numbers update live.
- Whatever is on the card at **Hit** is the "chosen option"; the ranked list and
  the chosen option are snapshotted into `shots.recommendation`.

### 9.5 Decision and execution grading (post-round)
- `strategy_loss = E(chosen) − E(best)` (≥ 0). `decision_grade = good` if
  `strategy_loss ≤ 0.05`, else `poor`.
- `execution_loss = E(chosen) − (E(actual landing) + 1)`… expressed as
  `sg_shot − sg_expected_given_choice`; negative means worse than the pattern
  predicted. `execution_grade = poor` if below the pattern's 20th percentile
  outcome for that choice.
- Round summary: total strokes lost to strategy, to execution, split by club and
  by shot category; the 2×2 counts; the five most expensive shots with their
  map thumbnails.

---

## 10. Strokes gained, scoring and handicap (`packages/engine/scoring`)

### 10.1 Strokes gained
`sg_shot = E(before) − E(after) − stroke_count` where `E(after) = 0` if holed.
Categories: **OTT** = first shot on par 4/5; **APP** = any other shot starting
> 27 m (30 yds) from the hole not on the green; **ARG** = ≤ 27 m and not on the
green; **PUTT** = on the green. Penalty records attach to the shot that caused
them. Per-round and rolling 5/10/20-round trends; per-club SG for APP/OTT.

### 10.2 Stableford and net
Course handicap `= round(HI × slope/113 + (CR − par))`; playing handicap
= 95 % of course handicap for individual Stableford (Golf Ireland allowance;
configurable). Strokes received per hole from stroke index; points
`= max(0, 2 + net_par − net_score)`.

### 10.3 WHS index (local computation)
Adjusted gross applies net double bogey per hole. Differential
`= (113 / slope) × (adjusted_gross − course_rating)` (PCC assumed 0; editable).
Index = average of the best 8 of the last 20 differentials with the WHS
small-sample table (1–19 scores), then soft cap / hard cap relative to the low
index in the past 365 days. The player's official index can be entered at any
time and is used for course handicap when present; the app's own figure is
shown alongside as "CaddyMate estimate".

---

## 11. Garmin watch companion (Phase D)

- Connect IQ **device app** for Vivoactive 5 (Monkey C, CIQ 5.x API level for
  that device). Phone ↔ watch messages via the Connect IQ Mobile SDK inside the
  Expo app (native module: Android SDK and iOS SDK, bridged once).
- Watch shows: hole, distances (front/centre/back, to the recommended landing
  point), recommended club and aim text ("9 yds L"), a simplified cone glyph.
- Watch actions: **Hit** and **Ball here** (send the watch's own GPS fix and
  timestamp to the phone), club picker (list pushed from the phone), **Holed**.
- The phone remains the source of truth: the watch never computes strategy.
- Fallback: if the phone is unreachable, the watch buffers position marks and
  replays them on reconnect.

---

## 12. Simulator import (web, Phase A)

- Web page: upload GSPro shot-history CSV or Square Golf export; the parser
  auto-detects the format by header row.
- Column mapping UI persisted per format; club names mapped to `clubs` via
  `sim_name_aliases` (first import asks, later imports remember).
- Fields kept: club, timestamp, carry, total, offline (+ raw row in
  `sim_sessions` payload for future use — spin, launch etc. are stored but not
  used).
- Dedup by file hash and by (timestamp, club, carry) within ±1 s.
- On import the Edge Function refits the affected clubs and the mobile app
  picks up the new patterns on next sync.

---

## 13. Course editor (web)

- OSM import via Overpass for a bounding box: `golf=fairway|green|bunker|
  water_hazard|rough|tee|hole` mapped into `hole_features`/`holes`/`tee_markers`.
- Map-draw tools (polygon, line, point) to fix or add features; snapping;
  per-hole assignment; hole line-of-play editing; stroke index and par entry.
- Publishing creates a new `course_version`; rounds pin their version.
- Moyvalley: the v1 database has 18 holes with green/fairway/rough polygons and
  tee points but no hazards. Whether to migrate those polygons or re-import from
  OSM and fix up is **deferred** (per interview); the importer will support
  both paths.

---

## 14. Post-round review (mobile + web)

- **Round replay**: per hole, map with every shot, the cone/ellipse shown at the
  time, the recommendation, the actual result; scrub through shots.
- **Decision grading** view: the 2×2, strategy vs. execution strokes lost, the
  worst five decisions with one-line explanations ("Aimed at pin over water with
  7i: 31 % wet. Best: 6i 12 yds left, 6 % wet.").
- **Strokes gained**: per category per round; trend charts (rolling); per club.
- **Dispersion evolution**: per club, the ellipse at the end of each of the last
  N rounds, overlaid; n and confidence.
- **Miss tendencies**: generated sentences from the pattern and buckets
  ("7i misses right 70 % in left-to-right wind", "approaches finish short 60 %").
- **Course view**: Moyvalley per-hole scoring average, SG per hole, tee
  strategy comparison (driver vs. 5-wood actual outcomes on each par 4/5).
- **Scorecard history** with the WHS ledger (last 20 differentials, which count).

Visual direction: TheGrint-like — dark satellite map, bold white distance
numerals, green accent, card-based sheets, dense but legible stats screens.
Tokens live in `packages/ui`.

---

## 15. Phases and acceptance criteria

Each phase ends with something usable on a Saturday.

### Phase 0 — Foundation (1 week)
Monorepo, CI, Supabase schema v2 + RLS, auth (email OTP + Google/Apple), Expo
dev build on the Android phone, MapLibre satellite map centred on Moyvalley,
engine package skeleton with geo maths tested.
*Done when:* signed-in app shows the Moyvalley map with hole outlines.

### Phase 1 — MVP round (2–3 weeks)
Bag setup with stock distances, round start, play view, pre-shot card (club,
lie, slope with terrain suggestion, intended line by tap and feature-relative),
Hit / Ball here / Holed, chain reconstruction, edit shots, putt card, penalties,
weather + elevation on every shot, seeded cone/ellipse from priors (no learning
yet), scorecard with Stableford and course handicap, basic round list.
*Done when:* a full 18 at Moyvalley is logged with no edits needed beyond one
shot, and the cone drawn for the 7i is centred at ~160 yds adjusted for wind.

### Phase A — Sim import + neutral pattern model (2 weeks)
Web app with CSV import (GSPro + Square), club aliasing, `normaliseShot`,
pattern fitting with prior + recency + half-SDs + bias, condition buckets,
refit Edge Function, cones/ellipses driven by real patterns with confidence
labels, per-club pattern screen (scatter + ellipse + counts).
*Done when:* after importing a sim session, the 7i ellipse on the course
visibly reflects the sim scatter and the label says "forming/established".

### Phase B — DECADE strategy (3 weeks)
Expected-strokes tables, option evaluation, search, recommendation card,
accept/drag/re-rank, tee-shot club comparison, layup search, recommendation
snapshots, performance budget met on device.
*Done when:* on every shot the app proposes a club + aim with probabilities in
< 0.5 s and the choice is stored.

### Phase C — Review, grading, strokes gained, WHS (2–3 weeks)
SG per shot/category, decision & execution grading, round summary, replay,
dispersion evolution, miss tendencies, course view, WHS ledger and index,
official-index override, web review dashboard mirrors the mobile screens.
*Done when:* a round's review page shows strategy loss, execution loss, SG by
category, and the index matches Golf Ireland within 0.2.

### Phase D — Garmin watch (2–3 weeks, includes SDK bridging risk)
CIQ app, phone bridge module, Hit / Ball here / Holed / club picker from the
wrist, distances + recommendation display, offline buffer.
*Done when:* a full hole is logged without taking the phone out of the pocket.

### Later (not scheduled)
Practice/drill mode, carry estimation from sim carry ratios, learned condition
coefficients (§8.6) if not done in B, iGolf course licensing, offline mode,
multi-user features, billing.

---

## 16. Cross-cutting requirements

- **GPS quality:** use fused location on Android / CoreLocation on iOS with
  best accuracy while a round is live; record `accuracy_m` per fix; if
  `> 8 m` at Hit/Ball-here, prompt to wait a few seconds or accept.
- **Battery:** location updates at 1 Hz only while Play view is foregrounded;
  map tiles cached per course.
- **Sync:** shots are written locally first (SQLite via `expo-sqlite`) then
  pushed; the app is not offline-capable, but a dropped packet must never lose a
  shot.
- **Privacy/security:** RLS everywhere; no service-role key in clients; weather
  and elevation fetched through the app's own Edge Function so third-party keys
  stay server-side.
- **Testing:** engine package at 100 % branch coverage with property tests
  (e.g. normalise → re-apply is identity; cone quantiles monotone in σ);
  golden-file tests for SG and WHS from published worked examples; Detox/Maestro
  smoke test for "log a hole".
- **Observability:** Sentry on mobile + web; Edge Function logs; an
  `engine_version` on every derived row.
- **Performance budgets:** cold start < 3 s; map interaction 60 fps; strategy
  search per §9.3.

---

## 17. Assumptions and open questions

Assumptions made where the interview was silent (flag any that are wrong):

1. Intended line is captured by tapping a target point **or** by a
   feature-relative offset; both resolve to a bearing. Shape is optional.
2. Sim shots and course shots have equal weight in the neutral pattern
   ("weighting neutral for now").
3. Pins are green centroids; per-round manual pin edits are allowed.
4. Penalty relief is handled inside the app with a "penalty" record so the
   chain and SG stay correct.
5. GSPro's shot-history CSV and Square's export are the two import formats;
   others are ignored.
6. Playing handicap allowance 95 % for Stableford; PCC treated as 0.
7. Half-life 180 days for recency; prior pseudo-count 8.
8. The Moyvalley polygons from the v1 database are usable but may be re-imported
   from OSM; decision deferred.
9. The old `caddymate-staging` Supabase project is unnecessary and can be
   deleted; `caddymate-prod` is reused for v2 (v1 tables dropped after a backup
   export of the Moyvalley course rows).

Open questions for the next conversation:
- **Q1.** Should the app carry a small "why" explanation with each
  recommendation (one line) or just the numbers? (Spec assumes one line.)
- **Q2.** For tee shots on holes where you always hit driver, do you still want
  the driver/5-wood comparison shown, or only when it changes the answer?
- **Q3.** Handling of provisional balls / lost balls: treat as OB (stroke and
  distance) with a "lost" flag — acceptable?
- **Q4.** Do you want a "plays like" number (distance adjusted for wind,
  elevation and density) shown next to the raw distance on every shot?
  (Assumed yes.)
- **Q5.** Which stock distances should seed each club beyond driver/7i/PW? A
  loft-interpolated table will be used unless you provide them.
