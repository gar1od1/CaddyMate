/**
 * Strategy (DECADE, docs/SPEC.md §9) inputs and outputs for the play view:
 * the hole's `HoleGeometry` from the course bundle, the bag as
 * `StrategyClub`s (stored pattern or seeded prior), the `RecommendInput` for
 * a position with its cache key, the chosen option at Hit and the one-line
 * texts. Pure — the hook that runs the search off the render path lives in
 * useRecommendation.ts.
 */
import { effectivePattern, type Club, type Hole } from '@caddymate/api';
import {
  DEFAULT_CONDITION_MODEL,
  baselineForHandicap,
  evaluateChoice,
  explainOption,
  haversineDistanceM,
  prepareHole,
  type BaselineId,
  type ClubPattern,
  type ConditionModelV1,
  type Conditions,
  type Handedness,
  type HoleFeature as StrategyFeature,
  type HoleGeometry,
  type LatLng,
  type Lie,
  type Recommendation,
  type RecommendInput,
  type StanceSlope,
  type StrategyClub,
  type StrategyOption,
} from '@caddymate/engine';

/** The persona's handicap (§2) when neither the round nor the profile has one. */
export const DEFAULT_HANDICAP_INDEX = 13;

export const baselineFor = (handicapIndex: number | null): BaselineId =>
  baselineForHandicap(handicapIndex ?? DEFAULT_HANDICAP_INDEX);

/** Course-bundle hole → the strategy engine's geometry. Null without a green. */
export function holeGeometry(hole: Hole, pin: LatLng): HoleGeometry | null {
  if (!hole.green || !hole.greenCentre) return null;
  const features: StrategyFeature[] = [];
  for (const f of hole.features) {
    if (f.polygon) {
      features.push({ kind: f.kind, penalty: f.penalty, polygon: f.polygon });
    } else if (f.point) {
      const feature: StrategyFeature = { kind: f.kind, penalty: f.penalty, point: f.point };
      if (f.treeRadiusM !== null) feature.radiusM = f.treeRadiusM;
      features.push(feature);
    }
  }
  const geometry: HoleGeometry = {
    green: hole.green,
    greenCentre: hole.greenCentre,
    pin,
    features,
  };
  if (hole.lineOfPlay && hole.lineOfPlay.length >= 2) geometry.lineOfPlay = hole.lineOfPlay;
  return geometry;
}

/** Active non-putter clubs with their stored pattern, else the seeded prior (§8.3). */
export function strategyClubs(
  clubs: readonly Club[],
  patterns: ReadonlyMap<string, ClubPattern>,
  handicapIndex: number | null,
): StrategyClub[] {
  return clubs
    .filter((c) => c.active && c.kind !== 'putter')
    .map((c) => {
      const club: StrategyClub = {
        id: c.id,
        label: c.name,
        kind: c.kind,
        pattern: effectivePattern(c, patterns.get(c.id), {
          handicapIndex: handicapIndex ?? DEFAULT_HANDICAP_INDEX,
        }),
      };
      if (c.loftDeg !== null) club.loftDeg = c.loftDeg;
      return club;
    });
}

export interface PositionInput {
  start: LatLng;
  startLie: Lie;
  pin: LatLng;
  hole: Hole;
  conditions: Conditions;
  slope: StanceSlope;
  handedness: Handedness;
  /** The player's condition model (decision 007); default the engine's. */
  model?: ConditionModelV1;
  /** The bag from {@link strategyClubs}. */
  bag: readonly StrategyClub[];
  handicapIndex: number | null;
  isTeeShot: boolean;
}

/** Everything `recommend()` needs, or null when the hole or the bag can't support a search. */
export function buildRecommendInput(p: PositionInput): RecommendInput | null {
  if (p.startLie === 'green') return null;
  const geometry = holeGeometry(p.hole, p.pin);
  if (!geometry || p.bag.length === 0) return null;
  return {
    start: p.start,
    startLie: p.startLie,
    pin: p.pin,
    conditions: p.conditions,
    slope: p.slope,
    handedness: p.handedness,
    hole: prepareHole(geometry),
    baseline: baselineFor(p.handicapIndex),
    clubs: [...p.bag],
    isTeeShot: p.isTeeShot,
    ...(p.model ? { model: p.model } : {}),
  };
}

const r = (x: number, dp: number) => x.toFixed(dp);

const modelKeys = new WeakMap<ConditionModelV1, string>();

/**
 * Short fingerprint of a condition model for cache keys: '' for the engine
 * default (or none), else an FNV-1a hash of its JSON. Memoised per object.
 */
export function conditionModelKey(model: ConditionModelV1 | undefined): string {
  if (!model || model === DEFAULT_CONDITION_MODEL) return '';
  const hit = modelKeys.get(model);
  if (hit !== undefined) return hit;
  const json = JSON.stringify(model);
  let key = '';
  if (json !== JSON.stringify(DEFAULT_CONDITION_MODEL)) {
    let h = 0x811c9dc5;
    for (let i = 0; i < json.length; i++) {
      h ^= json.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    key = `m${(h >>> 0).toString(36)}`;
  }
  modelKeys.set(model, key);
  return key;
}

/**
 * Cache key for a position: rounded start/pin (~1 m), lie, slope, wind
 * (0.5 m/s, 10°), air, elevations, handedness, condition model, baseline
 * and the bag's patterns. Equal keys ⇒ the search would return the same answer.
 */
export function recommendationKey(p: PositionInput): string {
  const c = p.conditions;
  const bag = p.bag
    .map((k) => `${k.id}:${r(k.pattern.distance.mean, 1)}:${r(k.pattern.n_effective, 1)}`)
    .join(',');
  return [
    p.hole.id,
    `${r(p.start.lat, 5)},${r(p.start.lng, 5)}`,
    `${r(p.pin.lat, 5)},${r(p.pin.lng, 5)}`,
    p.startLie,
    `${p.slope.uphill}${p.slope.downhill}${p.slope.ballAboveFeet}${p.slope.ballBelowFeet}`,
    `${r(Math.round(c.windSpeedMps * 2) / 2, 1)}@${String(Math.round(c.windFromDeg / 10) * 10)}`,
    `${r(c.tempC, 0)}/${r(c.pressureHpa, 0)}`,
    `${r(c.elevationStartM, 1)}>${r(c.elevationEndM, 1)}`,
    p.handedness,
    conditionModelKey(p.model),
    baselineFor(p.handicapIndex),
    p.isTeeShot ? 'tee' : '',
    bag,
  ].join('|');
}

/** Aims closer than this are "the same aim" (the search grid is 2 m). */
export const SAME_AIM_M = 1;

/** The recommended option for `clubId` at (about) `aim`, if the search produced one. */
export function matchingOption(
  rec: Recommendation,
  clubId: string,
  aim: LatLng,
): StrategyOption | null {
  const all = [...rec.options, rec.baseline];
  return (
    all.find((o) => o.clubId === clubId && haversineDistanceM(o.aim, aim) < SAME_AIM_M) ?? null
  );
}

/**
 * The (club, aim) on the card evaluated on the recommendation's basis (§9.4):
 * reuses a matching ranked option, else `evaluateChoice`. Null when the club
 * is not in the strategy bag (e.g. putter).
 */
export function evaluateCardChoice(
  input: RecommendInput,
  rec: Recommendation | null,
  clubId: string,
  aim: LatLng,
): StrategyOption | null {
  const match = rec ? matchingOption(rec, clubId, aim) : null;
  if (match) return match;
  const club = input.clubs.find((c) => c.id === clubId);
  return club ? evaluateChoice(input, club, aim) : null;
}

/** "7i — aim 9 yds left of pin. 61 % green, 9 % bunker, 0.19 strokes better than at the pin." */
export const describeOption = (o: StrategyOption, rec: Recommendation) =>
  explainOption(o, rec.baseline, 'yards');

/** Short comparison of the card's choice with the best option. */
export function describeChoice(choice: StrategyOption, best: StrategyOption): string {
  const pct = (p: number) => `${String(Math.round(p * 100))} %`;
  const main =
    choice.kind === 'approach' ? `${pct(choice.pGreen)} green` : `${pct(choice.pFairway)} fairway`;
  const lost = choice.expectedStrokes - best.expectedStrokes;
  const cmp =
    Math.abs(lost) < 0.005
      ? 'as good as the best option'
      : lost > 0
        ? `${lost.toFixed(2)} strokes worse than the best option`
        : `${(-lost).toFixed(2)} strokes better than the best option`;
  return `${choice.clubLabel}: ${main}${choice.pPenalty >= 0.01 ? `, ${pct(choice.pPenalty)} penalty` : ''} — ${cmp}.`;
}

/** Tiny LRU for recommendations by position key. */
export class RecommendationCache {
  private readonly map = new Map<string, Recommendation>();
  constructor(private readonly max = 24) {}
  get(key: string): Recommendation | undefined {
    const v = this.map.get(key);
    if (v) {
      this.map.delete(key);
      this.map.set(key, v);
    }
    return v;
  }
  set(key: string, rec: Recommendation): void {
    this.map.delete(key);
    this.map.set(key, rec);
    while (this.map.size > this.max) {
      const oldest = this.map.keys().next().value;
      if (oldest === undefined) break;
      this.map.delete(oldest);
    }
  }
  get size(): number {
    return this.map.size;
  }
}
