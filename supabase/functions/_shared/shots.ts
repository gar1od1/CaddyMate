/**
 * `shots` / `hole_scores` rows <-> the domain types. `shotFromRow`,
 * `holeScoreFromRow` and `holeScoreToRow` mirror packages/api/src/{shots,
 * rounds}.ts (checked by `mirror_parity_test.ts`); `derivedShotPatch` is the
 * server-only diff of the engine-derived columns a job may rewrite.
 */
import type { RecommendationSnapshot, StanceSlope } from './engine/index.ts';
import { geographyToPoint, pointToEwkt } from './geography.ts';
import {
  type HoleScore,
  type HoleScoreRow,
  num,
  type Shot,
  type ShotConditions,
  type ShotRow,
} from './types.ts';

export function shotFromRow(r: ShotRow): Shot {
  return {
    id: r.shot_id,
    userId: r.user_id,
    roundId: r.round_id ?? '',
    holeNumber: r.hole_number ?? 0,
    seq: r.seq ?? 0,
    source: r.source,
    clubId: r.club_id,
    playedAt: r.played_at,
    start: geographyToPoint(r.start_position),
    startAccuracyM: num(r.start_accuracy_m),
    end: geographyToPoint(r.end_position),
    endAccuracyM: num(r.end_accuracy_m),
    holed: r.holed,
    reconstructed: r.reconstructed,
    target: geographyToPoint(r.target_point),
    targetBearingDeg: num(r.target_bearing_deg),
    targetRef: r.target_ref ?? null,
    intendedShape: r.intended_shape,
    lie: r.lie,
    slope: {
      uphill: r.slope_up,
      downhill: r.slope_down,
      ballAboveFeet: r.slope_above,
      ballBelowFeet: r.slope_below,
    },
    strike: r.strike,
    penalty: r.penalty,
    strokeCount: r.stroke_count,
    conditions: (r.conditions as ShotConditions | null) ?? null,
    puttDistanceM: num(r.putt_distance_m),
    puttRemainingM: num(r.putt_remaining_m),
    slopeSuggested: (r.slope_suggested as StanceSlope | null) ?? null,
    recommendation: (r.recommendation as RecommendationSnapshot | null) ?? null,
    observedDistanceM: num(r.observed_distance_m),
    observedLateralM: num(r.observed_lateral_m),
    neutralDistanceM: num(r.neutral_distance_m),
    neutralLateralM: num(r.neutral_lateral_m),
    conditionModelVersion: r.condition_model_version,
    resultSurface: r.result_surface,
    distanceToPinBeforeM: num(r.distance_to_pin_before_m),
    distanceToPinAfterM: num(r.distance_to_pin_after_m),
  };
}

export function holeScoreFromRow(r: HoleScoreRow): HoleScore {
  return {
    roundId: r.round_id,
    holeNumber: r.hole_number,
    strokesLogged: r.strokes_logged,
    strokesOverride: r.strokes_override,
    overrideReason: r.override_reason,
    putts: r.putts,
    penalties: r.penalties,
    points: r.points,
    netStrokes: r.net_strokes,
  };
}

export function holeScoreToRow(s: HoleScore): HoleScoreRow {
  return {
    round_id: s.roundId,
    hole_number: s.holeNumber,
    strokes_logged: s.strokesLogged,
    strokes_override: s.strokesOverride,
    override_reason: s.overrideReason,
    putts: s.putts,
    penalties: s.penalties,
    points: s.points,
    net_strokes: s.netStrokes,
  };
}

/** Columns a server job may rewrite on a shot (all derived; never inputs or the snapshot). */
export interface DerivedShotPatch {
  seq?: number;
  start_position?: string | null;
  end_position?: string | null;
  conditions?: ShotConditions | null;
  observed_distance_m?: number | null;
  observed_lateral_m?: number | null;
  neutral_distance_m?: number | null;
  neutral_lateral_m?: number | null;
  condition_model_version?: number | null;
  result_surface?: Shot['resultSurface'];
  distance_to_pin_before_m?: number | null;
  distance_to_pin_after_m?: number | null;
}

const samePt = (a: Shot['start'], b: Shot['start']) =>
  a === b || (a !== null && b !== null && a.lat === b.lat && a.lng === b.lng);

/**
 * The derived columns that differ between `before` and `after` (same shot),
 * or null when nothing changed. Geometry is sent as EWKT.
 */
export function derivedShotPatch(before: Shot, after: Shot): DerivedShotPatch | null {
  const p: DerivedShotPatch = {};
  if (before.seq !== after.seq) p.seq = after.seq;
  if (!samePt(before.start, after.start)) p.start_position = pointToEwkt(after.start);
  if (!samePt(before.end, after.end)) p.end_position = pointToEwkt(after.end);
  if (JSON.stringify(before.conditions) !== JSON.stringify(after.conditions)) {
    p.conditions = after.conditions;
  }
  const pairs: [keyof DerivedShotPatch, keyof Shot][] = [
    ['observed_distance_m', 'observedDistanceM'],
    ['observed_lateral_m', 'observedLateralM'],
    ['neutral_distance_m', 'neutralDistanceM'],
    ['neutral_lateral_m', 'neutralLateralM'],
    ['condition_model_version', 'conditionModelVersion'],
    ['result_surface', 'resultSurface'],
    ['distance_to_pin_before_m', 'distanceToPinBeforeM'],
    ['distance_to_pin_after_m', 'distanceToPinAfterM'],
  ];
  for (const [col, key] of pairs) {
    if (before[key] !== after[key]) (p as Record<string, unknown>)[col] = after[key];
  }
  return Object.keys(p).length ? p : null;
}
