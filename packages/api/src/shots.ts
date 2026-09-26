import {
  FLAT_STANCE,
  sampleElevation,
  type RecommendationSnapshot,
  type StanceSlope,
} from '@caddymate/engine';
import type { Db } from './client.js';
import { listClubs } from './clubs.js';
import { getCourseBundle } from './courses.js';
import { loadElevationGrid } from './elevation.js';
import { check, must, num } from './errors.js';
import { geographyToPoint, pointToEwkt } from './geography.js';
import { applyTally, recomputeHoleShots, tallyHole } from './hole.js';
import { surfaceAt } from './playgeo.js';
import { getProfile, playerConditionModel } from './profiles.js';
import { holeScoreFromRow, roundFromRow, upsertHoleScores } from './rounds.js';
import type { HoleScore, Json, Row, Shot, ShotConditions, Tables, TargetRef } from './types.js';

export function shotFromRow(r: Row<'shots'>): Shot {
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
    targetRef: (r.target_ref as unknown as TargetRef | null) ?? null,
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
    conditions: (r.conditions as unknown as ShotConditions | null) ?? null,
    puttDistanceM: num(r.putt_distance_m),
    puttRemainingM: num(r.putt_remaining_m),
    slopeSuggested: (r.slope_suggested as unknown as StanceSlope | null) ?? null,
    recommendation: (r.recommendation as unknown as RecommendationSnapshot | null) ?? null,
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

/**
 * Client-writable columns plus the outputs of the shared pure recompute
 * (observed/neutral). SG and grades are never sent. `recommendation` is sent
 * only when set: it is write-once (DB trigger), so an absent key leaves the
 * stored snapshot alone.
 */
export function shotToRow(s: Shot): Tables['shots']['Insert'] {
  return {
    ...(s.recommendation ? { recommendation: s.recommendation as unknown as Json } : {}),
    shot_id: s.id,
    user_id: s.userId,
    round_id: s.roundId,
    hole_number: s.holeNumber,
    seq: s.seq,
    source: s.source,
    club_id: s.clubId,
    played_at: s.playedAt,
    start_position: pointToEwkt(s.start),
    start_accuracy_m: s.startAccuracyM,
    end_position: pointToEwkt(s.end),
    end_accuracy_m: s.endAccuracyM,
    holed: s.holed,
    reconstructed: s.reconstructed,
    target_point: pointToEwkt(s.target),
    target_bearing_deg: s.targetBearingDeg,
    target_ref: s.targetRef as unknown as Json,
    intended_shape: s.intendedShape,
    lie: s.lie,
    slope_up: s.slope.uphill,
    slope_down: s.slope.downhill,
    slope_above: s.slope.ballAboveFeet,
    slope_below: s.slope.ballBelowFeet,
    strike: s.strike,
    penalty: s.penalty,
    stroke_count: s.strokeCount,
    conditions: s.conditions as unknown as Json,
    putt_distance_m: s.puttDistanceM,
    putt_remaining_m: s.puttRemainingM,
    slope_suggested: s.slopeSuggested as unknown as Json,
    observed_distance_m: s.observedDistanceM,
    observed_lateral_m: s.observedLateralM,
    neutral_distance_m: s.neutralDistanceM,
    neutral_lateral_m: s.neutralLateralM,
    condition_model_version: s.conditionModelVersion,
    result_surface: s.resultSurface,
    distance_to_pin_before_m: s.distanceToPinBeforeM,
    distance_to_pin_after_m: s.distanceToPinAfterM,
  };
}

/** A blank course shot with defaults; callers fill in what they know. */
export function newShot(
  base: Pick<Shot, 'id' | 'userId' | 'roundId' | 'holeNumber' | 'seq'> & Partial<Shot>,
): Shot {
  return {
    source: 'course',
    clubId: null,
    playedAt: new Date().toISOString(),
    start: null,
    startAccuracyM: null,
    end: null,
    endAccuracyM: null,
    holed: false,
    reconstructed: false,
    target: null,
    targetBearingDeg: null,
    targetRef: null,
    intendedShape: null,
    lie: null,
    slope: FLAT_STANCE,
    strike: 'good',
    penalty: 'none',
    strokeCount: 1,
    conditions: null,
    puttDistanceM: null,
    puttRemainingM: null,
    slopeSuggested: null,
    recommendation: null,
    observedDistanceM: null,
    observedLateralM: null,
    neutralDistanceM: null,
    neutralLateralM: null,
    conditionModelVersion: null,
    resultSurface: null,
    distanceToPinBeforeM: null,
    distanceToPinAfterM: null,
    ...base,
  };
}

export async function listShots(db: Db, roundId: string, holeNumber?: number): Promise<Shot[]> {
  let q = db.from('shots').select('*').eq('round_id', roundId);
  if (holeNumber !== undefined) q = q.eq('hole_number', holeNumber);
  const rows = must(await q.order('hole_number').order('seq'), 'listShots');
  return rows.map(shotFromRow);
}

export async function insertShot(db: Db, shot: Shot): Promise<Shot> {
  const row = must(
    await db.from('shots').insert(shotToRow(shot)).select('*').single(),
    'insertShot',
  );
  return shotFromRow(row);
}

export async function updateShot(db: Db, shot: Shot): Promise<Shot> {
  const row = must(
    await db.from('shots').update(shotToRow(shot)).eq('shot_id', shot.id).select('*').single(),
    'updateShot',
  );
  return shotFromRow(row);
}

export async function deleteShot(db: Db, shotId: string): Promise<void> {
  check(await db.from('shots').delete().eq('shot_id', shotId), 'deleteShot');
}

export async function deleteShots(db: Db, shotIds: string[]): Promise<void> {
  if (!shotIds.length) return;
  check(await db.from('shots').delete().in('shot_id', shotIds), 'deleteShots');
}

/** Offset used to park seqs while renumbering, clear of any real seq. */
const SEQ_PARK = 1000;

/**
 * Write the complete, already-chained shot list of one hole. Idempotent.
 * `(round_id, hole_number, seq)` is unique and not deferrable, so renumbering
 * (insert-before, delete) is done in two passes: park every seq out of the
 * way, then write the final seqs.
 */
export async function upsertHoleShots(db: Db, shots: readonly Shot[]): Promise<void> {
  if (!shots.length) return;
  const rows = shots.map(shotToRow);
  check(
    await db.from('shots').upsert(
      rows.map((r) => ({ ...r, seq: (r.seq ?? 0) + SEQ_PARK })),
      { onConflict: 'shot_id' },
    ),
    'upsertHoleShots(park)',
  );
  check(await db.from('shots').upsert(rows, { onConflict: 'shot_id' }), 'upsertHoleShots');
}

export interface RecomputeResult {
  shots: Shot[];
  score: HoleScore;
}

/**
 * Server-side recompute of one hole: loads the round, the course geometry,
 * the player's clubs, handedness and condition model (decision 007), the course elevation grid (best effort;
 * GPS altitudes are used without one) and the hole's shots, re-chains and
 * re-derives them including neutral results (see `recomputeHoleShots`),
 * writes the shots back and upserts `hole_scores`.
 */
export async function recomputeHole(
  db: Db,
  roundId: string,
  holeNumber: number,
): Promise<RecomputeResult> {
  const roundRow = must(
    await db.from('rounds').select('*, hole_scores(*)').eq('round_id', roundId).single(),
    'recomputeHole(round)',
  );
  const round = roundFromRow(roundRow);
  const bundle = await getCourseBundle(db, round.courseId, round.courseVersion);
  const hole = bundle.holes.find((h) => h.number === holeNumber);
  const pin = round.pinOverrides[String(holeNumber)] ?? hole?.greenCentre ?? null;
  const [clubs, profile, grid] = await Promise.all([
    listClubs(db),
    getProfile(db, round.userId),
    loadElevationGrid(db, round.courseId, round.courseVersion).catch(() => null),
  ]);

  const shots = recomputeHoleShots(await listShots(db, roundId, holeNumber), {
    pin,
    surfaceAt: (p) => surfaceAt(bundle.holes, p, holeNumber).lie,
    clubFor: (id) => clubs.find((c) => c.id === id) ?? null,
    handedness: profile?.handedness ?? 'R',
    elevationAt: grid ? (p) => sampleElevation(grid, p) : null,
    model: playerConditionModel(profile),
  });
  await upsertHoleShots(db, shots);

  const prevRow = roundRow.hole_scores.find((h) => h.hole_number === holeNumber);
  const score = applyTally(
    prevRow ? holeScoreFromRow(prevRow) : null,
    roundId,
    holeNumber,
    tallyHole(shots),
  );
  await upsertHoleScores(db, [score]);
  return { shots, score };
}
