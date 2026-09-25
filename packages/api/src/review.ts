/**
 * Post-round review (docs/SPEC.md §9.5, §10, §14): strokes gained per shot,
 * decision / execution grading from the recommendation snapshots, round and
 * trend summaries, dispersion evolution, miss-tendency sentences and the WHS
 * ledger.
 *
 * `buildRoundReview` is pure (the mobile app runs it on its local store,
 * offline); `gradeRound` loads the same inputs from the database, runs it and
 * writes `sg`, `sg_category`, `strategy_loss`, `execution_loss`,
 * `decision_grade`, `execution_grade` back to `shots`.
 *
 * Grading basis (all E = expected strokes remaining after the shot, penalty
 * strokes included, 0 when holed — the same basis as `E_option`, §9.2):
 * - `E_best`   = the snapshot's top option (or its baseline if lower);
 * - `E_chosen` = the snapshot's chosen option;
 * - `E_actual` = E(where the next shot is played from) + penalty strokes
 *                charged to this shot beyond the stroke itself; for a missed
 *                last putt, `result_surface` / `distance_to_pin_after_m`.
 *                Using the next shot's start makes a drop / stroke-and-
 *                distance replay land where the player actually played from;
 * - `E_p20`    = the chosen option's 20th-percentile (worse-side) outcome.
 *                The snapshot stores only means and probabilities, not the
 *                sample distribution, and re-running `evaluateChoice` would
 *                need the pattern as it was at the time (not stored) and
 *                would still return only the mean. So it is approximated
 *                analytically, see {@link approxOutcomeP20}.
 */
import {
  DECISION_GOOD_MAX_LOSS,
  baselineForHandicap,
  expectedStrokes,
  fitPattern,
  gradeShot,
  handicapIndex,
  haversineDistanceM,
  lieToSgCategory,
  metresToYards,
  roundGradingSummary,
  sgCategory,
  sgForShot,
  sgSummary,
  whsScoreTable,
  type BaselineId,
  type BaselineTable,
  type ClubPattern,
  type FeatureKind,
  type GradeMatrix,
  type GradedShot,
  type GradingTotals,
  type HandicapIndexResult,
  type RecommendationSnapshot,
  type RoundGradingSummary,
  type SgCategory,
  type SgLieCategory,
  type SgPosition,
  type SgRoundSummary,
  type ShotGrade,
  type SnapshotOption,
} from '@caddymate/engine';
import type { Db } from './client.js';
import { listClubs } from './clubs.js';
import { check, must, mustMaybe, num } from './errors.js';
import { holeStrokes, isPenaltyRecord, isPutt, orderShots } from './hole.js';
import {
  clubPrior,
  getClubPatterns,
  PATTERN_SHOT_COLUMNS,
  patternShotsFromRows,
} from './patterns.js';
import type { PatternShotRow } from './patterns.js';
import { holeScoreFromRow, roundFromRow } from './rounds.js';
import { listShots, shotFromRow } from './shots.js';
import type { HoleScore, LieKind, Round, Shot, StoredConditionPattern, Tables } from './types.js';

/** The persona's handicap (§2) when neither the round nor the profile has one. */
export const REVIEW_DEFAULT_HANDICAP = 13;

/** z of the 80th percentile of a standard normal: E_p20 = mean + Z80·σ. */
export const Z80 = 0.8416212335729143;

/** Relative spread used for E_p20 when the club has no pattern: 7 % of the shot length. */
export const FALLBACK_SPREAD_FRAC = 0.07;

const round3 = (x: number) => Math.round(x * 1000) / 1000;
const clamp01 = (p: number) => Math.min(1, Math.max(0, p));

// ---------------------------------------------------------------------------
// Strokes gained per shot
// ---------------------------------------------------------------------------

export interface ShotSg {
  sg: number;
  category: SgCategory;
  before: SgPosition;
  after: SgPosition | 'holed';
  /** Strokes charged to the shot: 1, plus penalty strokes attached to it. */
  charged: number;
  /** E(after), penalties excluded; 0 when holed. */
  eAfter: number;
}

/** Where a real (non-penalty) shot was played from, as an SG position. */
function positionBefore(s: Shot, prev: Shot | null, first: boolean): SgPosition | null {
  if (s.distanceToPinBeforeM === null) return null;
  const lie: LieKind = s.lie ?? (first ? 'tee' : (prev?.resultSurface ?? 'fairway'));
  return { category: lieToSgCategory(lie), distanceM: s.distanceToPinBeforeM };
}

/**
 * Strokes gained for each real shot of one hole (§10.1). Penalty records
 * (club null, penalty set) get no SG of their own: their strokes attach to
 * the shot that caused them, whose "after" position is where the next real
 * shot is played from (the drop, or the original spot for stroke and
 * distance). Shots without a start distance or an after position are
 * skipped.
 */
export function holeShotSg(
  shots: readonly Shot[],
  par: number,
  baseline: BaselineTable | BaselineId,
): Map<string, ShotSg> {
  const ordered = orderShots(shots);
  const real = ordered.filter((s) => !isPenaltyRecord(s));
  const out = new Map<string, ShotSg>();
  real.forEach((s, i) => {
    const before = positionBefore(s, real[i - 1] ?? null, i === 0);
    if (!before) return;
    // Penalty records between this shot and the next real one.
    const at = ordered.indexOf(s);
    let recordStrokes = 0;
    let recordPenalty: Shot['penalty'] = 'none';
    for (let j = at + 1; j < ordered.length && isPenaltyRecord(ordered[j]!); j++) {
      recordStrokes += ordered[j]!.strokeCount;
      if (recordPenalty === 'none') recordPenalty = ordered[j]!.penalty;
    }
    let after: SgPosition | 'holed' | null;
    if (s.holed) after = 'holed';
    else {
      const next = real[i + 1];
      after = next
        ? positionBefore(next, s, false)
        : s.resultSurface !== null && s.distanceToPinAfterM !== null
          ? { category: lieToSgCategory(s.resultSurface), distanceM: s.distanceToPinAfterM }
          : null;
    }
    if (!after) return;
    const penalty = s.penalty !== 'none' ? s.penalty : recordPenalty;
    const strokeCount = s.strokeCount + recordStrokes;
    const sg = sgForShot({ before, after, strokeCount, penalty }, baseline);
    const eAfter =
      after === 'holed' ? 0 : expectedStrokes(baseline, after.category, after.distanceM);
    const eBefore = expectedStrokes(baseline, before.category, before.distanceM);
    out.set(s.id, {
      sg,
      category: sgCategory({ before, seq: i + 1, par }),
      before,
      after,
      charged: eBefore - eAfter - sg,
      eAfter,
    });
  });
  return out;
}

// ---------------------------------------------------------------------------
// Grading
// ---------------------------------------------------------------------------

/**
 * `E_p20` of an option: the value 80 % of its outcomes beat. The snapshot
 * has the mean `E` and the outcome probabilities but not the per-sample
 * distribution, so the outcome SD is estimated from three independent
 * sources and a normal tail is applied, `E_p20 = E + Z80·σ` (Z80 ≈ 0.84):
 * - penalty: a Bernoulli(pPenalty) extra stroke, `p(1−p)`;
 * - lie: hitting the target surface (green for approaches, fairway for
 *   layups) or not, Bernoulli(p) × (E(rough) − E(target)) at the expected
 *   remaining distance;
 * - distance: the slope of E around the expected remaining distance times
 *   the pattern's radial spread `√((sd_d² + sd_lat²)/2)`, where `sd_lat`
 *   averages the half-SDs. Without a pattern the spread is
 *   {@link FALLBACK_SPREAD_FRAC} of the shot length.
 */
export function approxOutcomeP20(
  option: SnapshotOption,
  baseline: BaselineTable | BaselineId,
  pattern: ClubPattern | null,
  shotLengthM: number,
): number {
  const R = Math.max(0, option.expectedRemainingM);
  const target: SgLieCategory = option.kind === 'approach' ? 'green' : 'fairway';
  const pTarget = clamp01(option.kind === 'approach' ? option.pGreen : option.pFairway);
  const pPen = clamp01(option.pPenalty);
  const E = (c: SgLieCategory, d: number) => expectedStrokes(baseline, c, Math.max(0, d));
  const dLie = Math.max(0, E('rough', R) - E(target, R));
  const h = 5;
  const lo = Math.max(0, R - h);
  const slopeOf = (c: SgLieCategory) => (E(c, R + h) - E(c, lo)) / (R + h - lo);
  const slope = pTarget * slopeOf(target) + (1 - pTarget) * slopeOf('rough');
  const spread = pattern
    ? Math.sqrt(
        (pattern.distance.sd ** 2 +
          ((pattern.lateral.sd_left + pattern.lateral.sd_right) / 2) ** 2) /
          2,
      )
    : FALLBACK_SPREAD_FRAC * Math.max(0, shotLengthM);
  const variance = pPen * (1 - pPen) + pTarget * (1 - pTarget) * dLie ** 2 + (slope * spread) ** 2;
  return option.expectedStrokes + Z80 * Math.sqrt(variance);
}

export interface ShotReviewGrade extends ShotGrade {
  eBest: number;
  eChosen: number;
  eActual: number;
  eP20: number;
}

/** The best option of a snapshot: its top option, or the baseline when that is lower. */
export function bestOption(snap: RecommendationSnapshot): SnapshotOption {
  const top = snap.options[0];
  return top && top.expectedStrokes <= snap.baseline.expectedStrokes ? top : snap.baseline;
}

/** Grade one shot against its snapshot (§9.5). Null without a chosen option. */
export function gradeFromSnapshot(
  snap: RecommendationSnapshot | null,
  shotSg: Pick<ShotSg, 'eAfter' | 'charged'>,
  baseline: BaselineTable | BaselineId,
  pattern: ClubPattern | null,
  distanceBeforeM: number,
): ShotReviewGrade | null {
  const chosen = snap?.chosen;
  if (!snap || !chosen) return null;
  const eBest = bestOption(snap).expectedStrokes;
  const eChosen = chosen.expectedStrokes;
  const eActual = shotSg.eAfter + Math.max(0, shotSg.charged - 1);
  const eP20 = approxOutcomeP20(
    chosen,
    baseline,
    pattern,
    Math.max(0, distanceBeforeM + chosen.aimOffsetM.alongM),
  );
  return { ...gradeShot({ eBest, eChosen, eActual, eP20 }), eBest, eChosen, eActual, eP20 };
}

// ---------------------------------------------------------------------------
// One-line explanations (§14)
// ---------------------------------------------------------------------------

const pct = (p: number) => `${String(Math.round(p * 100))} %`;
const yds = (m: number) => `${String(Math.round(metresToYards(Math.abs(m))))} yds`;

const RISK_WORD: Partial<Record<FeatureKind | 'ob', string>> = {
  water: 'wet',
  bunker: 'in sand',
  tree: 'in trees',
  wooded: 'in trees',
  ob: 'OB',
};

/** The option's biggest risk (hazard kind or OB) of at least 1 %, if any. */
function topRisk(o: SnapshotOption): FeatureKind | 'ob' | null {
  const risks: [FeatureKind | 'ob', number][] = [
    ...(Object.entries(o.pHazardByKind) as [FeatureKind, number][]),
    ['ob', o.pOb],
  ];
  const top = risks.filter(([, p]) => p >= 0.01).sort((a, b) => b[1] - a[1])[0];
  return top ? top[0] : null;
}

const riskP = (o: SnapshotOption, k: FeatureKind | 'ob') =>
  k === 'ob' ? o.pOb : (o.pHazardByKind[k] ?? 0);

/** "31 % wet" for the given risk, else "61 % green" / "70 % fairway". */
function riskPhrase(o: SnapshotOption, k: FeatureKind | 'ob' | null): string {
  if (k) return `${pct(riskP(o, k))} ${RISK_WORD[k] ?? 'in a hazard'}`;
  return o.kind === 'approach' ? `${pct(o.pGreen)} green` : `${pct(o.pFairway)} fairway`;
}

/** "at the pin" / "9 yds left" / "to 180 yds, 5 yds right". */
function aimShort(o: SnapshotOption): string {
  if (o.kind === 'approach') {
    const lat = o.aimOffsetM.lateralM;
    if (Math.round(metresToYards(Math.abs(lat))) === 0) return 'at the pin';
    return `${yds(lat)} ${lat < 0 ? 'left' : 'right'}`;
  }
  const out = `to ${yds(Math.hypot(o.aimOffsetM.alongM, o.aimOffsetM.lateralM))}`;
  if (Math.round(metresToYards(Math.abs(o.lineOffsetM))) === 0) return out;
  return `${out}, ${yds(o.lineOffsetM)} ${o.lineOffsetM < 0 ? 'left' : 'right'}`;
}

function aimLong(o: SnapshotOption): string {
  if (o.kind === 'approach') {
    const s = aimShort(o);
    return s === 'at the pin' ? 'Aimed at the pin' : `Aimed ${s} of the pin`;
  }
  return `Laid up ${aimShort(o)}`;
}

export interface ActualFinish {
  holed: boolean;
  surface: LieKind | null;
  distanceAfterM: number | null;
  penalty: boolean;
}

function finishPhrase(a: ActualFinish): string {
  if (a.holed) return 'holed it';
  if (a.penalty) return 'took a penalty';
  const where = a.surface ? ` on the ${a.surface.replace('_', ' ')}` : '';
  return a.distanceAfterM !== null ? `finished ${yds(a.distanceAfterM)} away${where}` : 'finished';
}

/**
 * One line for a graded shot, built from its snapshot (§14), e.g.
 * "Aimed at the pin with 7i: 31 % wet. Best: 6i 12 yds left, 6 % wet." for a
 * poor decision, else the execution: "7i 9 yds left (61 % green) was the
 * right call; finished 34 yds away in the sand, 0.62 worse than expected."
 */
export function explainGradedShot(
  snap: RecommendationSnapshot,
  grade: ShotReviewGrade,
  actual: ActualFinish,
): string {
  const chosen = snap.chosen ?? snap.baseline;
  const risk = topRisk(chosen);
  if (grade.strategyLoss > DECISION_GOOD_MAX_LOSS) {
    const best = bestOption(snap);
    const bestRisk = risk ?? topRisk(best);
    return (
      `${aimLong(chosen)} with ${chosen.clubLabel}: ${riskPhrase(chosen, risk)}. ` +
      `Best: ${best.clubLabel} ${aimShort(best)}, ${riskPhrase(best, bestRisk)} ` +
      `(${grade.strategyLoss.toFixed(2)} strokes).`
    );
  }
  const d = grade.executionLoss;
  const result =
    Math.abs(d) < 0.005
      ? 'as expected'
      : `${Math.abs(d).toFixed(2)} ${d < 0 ? 'worse' : 'better'} than expected`;
  return (
    `${chosen.clubLabel} ${aimShort(chosen)} (${riskPhrase(chosen, risk)}) was the right call; ` +
    `${finishPhrase(actual)}, ${result}.`
  );
}

// ---------------------------------------------------------------------------
// Round review (pure)
// ---------------------------------------------------------------------------

export interface ReviewShot {
  shot: Shot;
  /** Null for penalty records and shots without positions. */
  sg: number | null;
  sgCategory: SgCategory | null;
  grade: ShotReviewGrade | null;
  explanation: string | null;
}

export interface ReviewHole {
  number: number;
  par: number;
  strokes: number | null;
  net: number | null;
  points: number | null;
  putts: number | null;
  penalties: number | null;
  /** Sum of the hole's shot SG. */
  sg: number;
  shots: ReviewShot[];
}

/** A graded shot as carried through `roundGradingSummary`. */
export interface GradedReviewShot extends GradedShot {
  shotId: string;
  holeNumber: number;
  seq: number;
  clubLabel: string | null;
  explanation: string;
}

export interface ClubSgRow {
  clubId: string;
  label: string;
  sg: number;
  count: number;
}

export interface ReviewTotals {
  par: number;
  gross: number | null;
  net: number | null;
  points: number | null;
  putts: number;
  penalties: number;
  adjustedGross: number | null;
  differential: number | null;
  holesPlayed: number;
}

export interface RoundReview {
  round: Round;
  baseline: BaselineId | 'custom';
  holes: ReviewHole[];
  sgSummary: SgRoundSummary;
  roundGradingSummary: RoundGradingSummary<GradedReviewShot>;
  /** Same as `roundGradingSummary.matrix`, surfaced for the 2×2. */
  matrix: GradeMatrix;
  mostExpensive: { shot: GradedReviewShot; cost: number }[];
  /** APP/OTT SG per club (§10.1), best first. */
  perClubSg: ClubSgRow[];
  totals: ReviewTotals;
  /** clubId → display name, as given. */
  clubLabels: Readonly<Record<string, string>>;
}

export interface RoundReviewInput {
  round: Round;
  holeScores: readonly HoleScore[];
  shots: readonly Shot[];
  /** Par per hole number. */
  pars: Readonly<Record<number, number>>;
  baseline: BaselineId | BaselineTable;
  /** Neutral club patterns (for the E_p20 spread). */
  patterns?: ReadonlyMap<string, ClubPattern>;
  /** clubId → display name. */
  clubLabels?: Readonly<Record<string, string>>;
}

/** Baseline band for a player: round handicap, else the given fallback, else the persona's. */
export function reviewBaseline(round: Pick<Round, 'handicapIndexUsed'>, fallback?: number | null) {
  return baselineForHandicap(round.handicapIndexUsed ?? fallback ?? REVIEW_DEFAULT_HANDICAP);
}

export function buildRoundReview(input: RoundReviewInput): RoundReview {
  const { round, baseline } = input;
  const labels = input.clubLabels ?? {};
  const byHole = new Map<number, Shot[]>();
  for (const s of input.shots) {
    if (s.source !== 'course') continue;
    const list = byHole.get(s.holeNumber) ?? [];
    list.push(s);
    byHole.set(s.holeNumber, list);
  }
  const holeNumbers = [
    ...new Set([
      ...Object.keys(input.pars).map(Number),
      ...byHole.keys(),
      ...input.holeScores.map((h) => h.holeNumber),
    ]),
  ].sort((a, b) => a - b);

  const sgRecords: { sg: number; category: SgCategory; clubId: string | null }[] = [];
  const graded: GradedReviewShot[] = [];
  const holes: ReviewHole[] = holeNumbers.map((number) => {
    const par = input.pars[number] ?? 4;
    const shots = orderShots(byHole.get(number) ?? []);
    const sgs = holeShotSg(shots, par, baseline);
    const reviewShots = shots.map((shot): ReviewShot => {
      const s = sgs.get(shot.id);
      if (!s) return { shot, sg: null, sgCategory: null, grade: null, explanation: null };
      sgRecords.push({ sg: s.sg, category: s.category, clubId: shot.clubId });
      const grade = gradeFromSnapshot(
        shot.recommendation,
        s,
        baseline,
        (shot.clubId && input.patterns?.get(shot.clubId)) || null,
        s.before.distanceM,
      );
      let explanation: string | null = null;
      if (grade && shot.recommendation) {
        explanation = explainGradedShot(shot.recommendation, grade, {
          holed: shot.holed,
          surface: shot.resultSurface,
          distanceAfterM: s.after === 'holed' ? 0 : s.after.distanceM,
          penalty: s.charged > 1.5,
        });
        graded.push({
          ...grade,
          shotId: shot.id,
          holeNumber: number,
          seq: shot.seq,
          clubId: shot.clubId,
          clubLabel: shot.clubId ? (labels[shot.clubId] ?? null) : null,
          category: s.category,
          explanation,
        });
      }
      return { shot, sg: s.sg, sgCategory: s.category, grade, explanation };
    });
    const score = input.holeScores.find((h) => h.holeNumber === number);
    const strokes = score && holeStrokes(score) > 0 ? holeStrokes(score) : null;
    return {
      number,
      par,
      strokes,
      net: score?.netStrokes ?? null,
      points: score?.points ?? null,
      putts: score ? score.putts : null,
      penalties: score ? score.penalties : null,
      sg: reviewShots.reduce((t, r) => t + (r.sg ?? 0), 0),
      shots: reviewShots,
    };
  });

  const summary = sgSummary(sgRecords);
  const grading = roundGradingSummary(graded);
  const perClubSg = Object.entries(summary.byClub)
    .map(([clubId, c]) => ({ clubId, label: labels[clubId] ?? clubId, sg: c.sg, count: c.count }))
    .sort((a, b) => b.sg - a.sg);

  const played = holes.filter((h) => h.strokes !== null);
  const sum = (f: (h: ReviewHole) => number) => played.reduce((t, h) => t + f(h), 0);
  const complete = holes.length > 0 && played.length === holes.length;
  const totals: ReviewTotals = {
    par: holes.reduce((t, h) => t + h.par, 0),
    gross: round.gross ?? (played.length ? sum((h) => h.strokes ?? 0) : null),
    net: complete && played.every((h) => h.net !== null) ? sum((h) => h.net ?? 0) : null,
    points:
      round.stableford ??
      (played.some((h) => h.points !== null) ? sum((h) => h.points ?? 0) : null),
    putts: sum((h) => h.putts ?? 0),
    penalties: sum((h) => h.penalties ?? 0),
    adjustedGross: round.adjustedGross,
    differential: round.differential,
    holesPlayed: played.length,
  };

  return {
    round,
    baseline: typeof baseline === 'string' ? baseline : 'custom',
    holes,
    sgSummary: summary,
    roundGradingSummary: grading,
    matrix: grading.matrix,
    mostExpensive: grading.mostExpensive,
    perClubSg,
    totals,
    clubLabels: labels,
  };
}

/** The `shots` grade columns for every course shot of a review (nulls where ungraded). */
export function reviewShotPatches(
  review: RoundReview,
): { shotId: string; patch: Tables['shots']['Update'] }[] {
  return review.holes.flatMap((h) =>
    h.shots.map((r) => ({
      shotId: r.shot.id,
      patch: {
        sg: r.sg === null ? null : round3(r.sg),
        sg_category: r.sgCategory,
        strategy_loss: r.grade ? round3(r.grade.strategyLoss) : null,
        execution_loss: r.grade ? round3(r.grade.executionLoss) : null,
        decision_grade: r.grade?.decisionGrade ?? null,
        execution_grade: r.grade?.executionGrade ?? null,
      },
    })),
  );
}

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

async function loadPars(
  db: Db,
  courseId: string,
  version: number,
): Promise<Record<number, number>> {
  const rows = must(
    await db.from('holes').select('hole_number, par, version').eq('course_id', courseId),
    'review(holes)',
  );
  return Object.fromEntries(
    rows.filter((r) => r.version === version).map((r) => [r.hole_number, r.par]),
  );
}

async function clubLabels(db: Db): Promise<Record<string, string>> {
  return Object.fromEntries((await listClubs(db)).map((c) => [c.id, c.name]));
}

async function officialIndex(db: Db, userId: string): Promise<number | null> {
  const row = mustMaybe(
    await db.from('profiles').select('handicap_index_official').eq('user_id', userId).maybeSingle(),
    'review(profile)',
  );
  return row ? num(row.handicap_index_official) : null;
}

export interface GradeRoundOptions {
  /** Handicap index for the SG baseline when the round has none (else the official index). */
  handicapIndex?: number | null;
  /** Write the grades back to `shots`. Default true. */
  write?: boolean;
}

const WRITE_CONCURRENCY = 8;

/**
 * Grade a round (§9.5, §10.1): SG per course shot against the player's
 * handicap baseline, decision and execution grades where a snapshot exists,
 * written back to `shots`, and the full {@link RoundReview}.
 */
export async function gradeRound(
  db: Db,
  roundId: string,
  opts: GradeRoundOptions = {},
): Promise<RoundReview> {
  const round = roundFromRow(
    must(await db.from('rounds').select('*').eq('round_id', roundId).single(), 'gradeRound'),
  );
  const [scoreRows, shots, pars, patterns, labels] = await Promise.all([
    db
      .from('hole_scores')
      .select('*')
      .eq('round_id', roundId)
      .then((r) => must(r, 'gradeRound(hole_scores)')),
    listShots(db, roundId),
    loadPars(db, round.courseId, round.courseVersion),
    getClubPatterns(db),
    clubLabels(db),
  ]);
  const fallback =
    opts.handicapIndex ??
    (round.handicapIndexUsed === null ? await officialIndex(db, round.userId) : null);
  const review = buildRoundReview({
    round,
    holeScores: scoreRows.map(holeScoreFromRow),
    shots,
    pars,
    baseline: reviewBaseline(round, fallback),
    patterns,
    clubLabels: labels,
  });
  if (opts.write !== false) {
    const patches = reviewShotPatches(review);
    for (let i = 0; i < patches.length; i += WRITE_CONCURRENCY) {
      await Promise.all(
        patches.slice(i, i + WRITE_CONCURRENCY).map(async ({ shotId, patch }) => {
          check(await db.from('shots').update(patch).eq('shot_id', shotId), 'gradeRound(write)');
        }),
      );
    }
  }
  return review;
}

// ---------------------------------------------------------------------------
// Trends
// ---------------------------------------------------------------------------

export interface TeeShotOutcome {
  roundId: string;
  courseId: string;
  holeNumber: number;
  par: number;
  clubId: string | null;
  clubLabel: string | null;
  sg: number;
  resultSurface: LieKind | null;
  penalty: boolean;
  /** Where the next shot was played from; null when holed. */
  remainingM: number | null;
  /** The snapshot's top option's club, if a snapshot exists. */
  recommendedClubId: string | null;
}

export interface RoundReviewSummary {
  roundId: string;
  courseId: string;
  courseName: string | null;
  startedAt: string;
  totals: ReviewTotals;
  sg: SgRoundSummary;
  grading: GradingTotals;
  matrix: GradeMatrix;
  holes: { number: number; par: number; strokes: number | null; sg: number }[];
  teeShots: TeeShotOutcome[];
}

export function summariseReview(
  review: RoundReview,
  courseName: string | null = null,
): RoundReviewSummary {
  const teeShots: TeeShotOutcome[] = [];
  for (const h of review.holes) {
    for (const r of h.shots) {
      if (r.sgCategory !== 'ott' || r.sg === null) continue;
      const next = h.shots.find((x) => x.shot.seq > r.shot.seq && !isPenaltyRecord(x.shot));
      teeShots.push({
        roundId: review.round.id,
        courseId: review.round.courseId,
        holeNumber: h.number,
        par: h.par,
        clubId: r.shot.clubId,
        clubLabel: r.shot.clubId ? (review.clubLabels[r.shot.clubId] ?? null) : null,
        sg: r.sg,
        resultSurface: r.shot.resultSurface,
        penalty: h.shots.some(
          (x) =>
            x.shot.seq > r.shot.seq &&
            isPenaltyRecord(x.shot) &&
            (next === undefined || x.shot.seq < next.shot.seq),
        ),
        remainingM: r.shot.holed ? null : (next?.shot.distanceToPinBeforeM ?? null),
        recommendedClubId: r.shot.recommendation ? bestOption(r.shot.recommendation).clubId : null,
      });
    }
  }
  return {
    roundId: review.round.id,
    courseId: review.round.courseId,
    courseName,
    startedAt: review.round.startedAt,
    totals: review.totals,
    sg: review.sgSummary,
    grading: review.roundGradingSummary.totals,
    matrix: review.matrix,
    holes: review.holes.map((h) => ({
      number: h.number,
      par: h.par,
      strokes: h.strokes,
      sg: h.sg,
    })),
    teeShots,
  };
}

const byStartedDesc = (a: { started_at: string }, b: { started_at: string }) =>
  b.started_at.localeCompare(a.started_at);

/**
 * The last `n` complete rounds, reviewed in memory (nothing is written),
 * oldest first so they feed `rollingSg` directly.
 */
export async function listRoundReviews(
  db: Db,
  n = 20,
  opts: { handicapIndex?: number | null } = {},
): Promise<RoundReviewSummary[]> {
  const roundRows = must(
    await db.from('rounds').select('*').eq('status', 'complete'),
    'listRoundReviews(rounds)',
  )
    .sort(byStartedDesc)
    .slice(0, n);
  if (!roundRows.length) return [];
  const ids = roundRows.map((r) => r.round_id);
  const courseIds = [...new Set(roundRows.map((r) => r.course_id))];
  const [scoreRows, shotRows, holeRows, courseRows, patterns, labels] = await Promise.all([
    db
      .from('hole_scores')
      .select('*')
      .in('round_id', ids)
      .then((r) => must(r, 'listRoundReviews(hole_scores)')),
    db
      .from('shots')
      .select('*')
      .in('round_id', ids)
      .then((r) => must(r, 'listRoundReviews(shots)')),
    db
      .from('holes')
      .select('course_id, version, hole_number, par')
      .in('course_id', courseIds)
      .then((r) => must(r, 'listRoundReviews(holes)')),
    db
      .from('courses')
      .select('course_id, name')
      .in('course_id', courseIds)
      .then((r) => must(r, 'listRoundReviews(courses)')),
    getClubPatterns(db),
    clubLabels(db),
  ]);
  const official =
    opts.handicapIndex ?? (await officialIndex(db, roundRows[0]!.user_id).catch(() => null));
  return roundRows
    .map((row) => {
      const round = roundFromRow(row);
      const pars = Object.fromEntries(
        holeRows
          .filter((h) => h.course_id === round.courseId && h.version === round.courseVersion)
          .map((h) => [h.hole_number, h.par]),
      );
      const review = buildRoundReview({
        round,
        holeScores: scoreRows.filter((s) => s.round_id === round.id).map(holeScoreFromRow),
        shots: shotRows.filter((s) => s.round_id === round.id).map(shotFromRow),
        pars,
        baseline: reviewBaseline(round, official),
        patterns,
        clubLabels: labels,
      });
      const name = courseRows.find((c) => c.course_id === round.courseId)?.name ?? null;
      return summariseReview(review, name);
    })
    .reverse();
}

// ---------------------------------------------------------------------------
// Dispersion evolution (§14)
// ---------------------------------------------------------------------------

export interface PatternAtRound {
  roundId: string;
  startedAt: string;
  finishedAt: string;
  pattern: ClubPattern;
}

/**
 * The club's neutral pattern as it stood at the end of each of the last
 * `rounds` complete rounds (oldest first): re-fitted with prior + recency
 * from the shots played up to that round's finish, recency measured from
 * the finish. Pure read, nothing is stored. Empty for putters.
 */
export async function dispersionHistory(
  db: Db,
  clubId: string,
  opts: { rounds?: number; handicapIndex?: number | null; halfLifeDays?: number } = {},
): Promise<PatternAtRound[]> {
  const clubRow = must(
    await db.from('clubs').select('kind, loft_deg, stock_total_m').eq('club_id', clubId).single(),
    'dispersionHistory(club)',
  );
  if (clubRow.kind === 'putter') return [];
  const club = {
    kind: clubRow.kind,
    loftDeg: num(clubRow.loft_deg),
    stockTotalM: num(clubRow.stock_total_m),
  };
  const [shotRows, roundRows] = await Promise.all([
    db
      .from('shots')
      .select(PATTERN_SHOT_COLUMNS)
      .eq('club_id', clubId)
      .then((r) => must(r, 'dispersionHistory(shots)') as unknown as PatternShotRow[]),
    db
      .from('rounds')
      .select('*')
      .eq('status', 'complete')
      .then((r) => must(r, 'dispersionHistory(rounds)')),
  ]);
  const shots = patternShotsFromRows(shotRows, 'neutral');
  const prior = clubPrior(club, { handicapIndex: opts.handicapIndex ?? null });
  return roundRows
    .filter((r) => r.finished_at !== null)
    .sort(byStartedDesc)
    .slice(0, opts.rounds ?? 5)
    .reverse()
    .map((r) => {
      const t = Date.parse(r.finished_at!);
      const upTo = shots.filter((s) => Number(s.playedAt) <= t);
      return {
        roundId: r.round_id,
        startedAt: r.started_at,
        finishedAt: r.finished_at!,
        pattern: fitPattern(upTo, {
          now: t,
          prior,
          ...(opts.halfLifeDays !== undefined ? { halfLifeDays: opts.halfLifeDays } : {}),
        }),
      };
    });
}

// ---------------------------------------------------------------------------
// Miss tendencies (§14)
// ---------------------------------------------------------------------------

/** Standard normal CDF (Abramowitz–Stegun 7.1.26, |ε| < 1.5e-7). */
export function normalCdf(z: number): number {
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-x * x);
  return z >= 0 ? 0.5 * (1 + y) : 0.5 * (1 - y);
}

/**
 * Share of shots finishing right of the intended line under the equal-mass
 * two-piece lateral normal (decision 003): each side of the mean holds half.
 */
export function probRight(p: Pick<ClubPattern, 'lateral'>): number {
  const { mean, sd_left, sd_right } = p.lateral;
  if (mean >= 0) return sd_left > 0 ? 1 - normalCdf(-mean / sd_left) : 1;
  return sd_right > 0 ? normalCdf(mean / sd_right) : 0;
}

/** A tendency needs at least this share (60 %) to be reported. */
export const TENDENCY_MIN_SHARE = 0.6;
/** …and at least this many of the player's own shots. */
export const TENDENCY_MIN_SHOTS = 8;
/** Spread ratio at which one side counts as "the big miss". */
export const BIG_MISS_RATIO = 1.3;
/** Relative distance change reported for a condition bucket (5 %). */
export const BUCKET_DISTANCE_FRAC = 0.05;

const STRONG_BINS = new Set(['..-4', '+4..']);
const CALM_BIN = '-1..1';

/**
 * "from the rough in a strong left-to-right wind" for a bucket key (§8.5,
 * `lie|h:<bin>|c:<bin>`; + cross = left-to-right, + head = into the wind),
 * or null for a calm fairway / tee bucket.
 */
export function describeBucket(key: string): string | null {
  const [lie, h, c] = key.split('|');
  const head = h?.replace('h:', '') ?? CALM_BIN;
  const cross = c?.replace('c:', '') ?? CALM_BIN;
  const parts: string[] = [];
  if (lie && lie !== 'fairway' && lie !== 'tee') parts.push(`from the ${lie.replace('_', ' ')}`);
  const hasCross = cross !== CALM_BIN;
  const hasHead = head !== CALM_BIN;
  if (hasCross || hasHead) {
    const strong =
      (hasCross && STRONG_BINS.has(cross)) || (hasHead && STRONG_BINS.has(head)) ? 'strong ' : '';
    const side = hasCross ? (cross.startsWith('+') ? 'left-to-right ' : 'right-to-left ') : '';
    const kind = hasHead ? (head.startsWith('+') ? 'headwind' : 'downwind') : 'wind';
    parts.push(`in a ${strong}${side}${kind}`);
  }
  return parts.length ? parts.join(' ') : null;
}

export interface TendencyPattern {
  clubId: string;
  params: ClubPattern;
}

export interface MissTendencyOptions {
  /** clubId → display name ("7i"). */
  labels?: Readonly<Record<string, string>>;
  /** Course shots for the approach short/long tendency. */
  shots?: readonly Shot[];
}

/**
 * Plain-language tendencies (§14) from the neutral patterns, the empirical
 * condition-bucket patterns and (optionally) course approach shots:
 * - lateral bias: "7i finishes right of the line 70 % of the time (avg 6 yds right)";
 * - the big miss: "Driver's big miss is left (spread 1.5× the right side)";
 * - per bucket: "7i misses right 72 % in a left-to-right wind",
 *   "7i goes 14 yds shorter in a strong headwind";
 * - approaches: "Approaches finish short 60 % of the time".
 * Only tendencies with ≥ 60 % share and ≥ 8 shots are reported.
 */
export function missTendencies(
  patterns: readonly TendencyPattern[],
  conditionPatterns: readonly StoredConditionPattern[],
  opts: MissTendencyOptions = {},
): string[] {
  const out: string[] = [];
  const label = (id: string) => opts.labels?.[id] ?? id;
  for (const { clubId, params: p } of patterns) {
    const name = label(clubId);
    if (p.n_effective >= TENDENCY_MIN_SHOTS) {
      const right = probRight(p);
      if (Math.max(right, 1 - right) >= TENDENCY_MIN_SHARE) {
        const side = right >= 0.5 ? 'right' : 'left';
        out.push(
          `${name} finishes ${side} of the line ${pct(Math.max(right, 1 - right))} of the time ` +
            `(avg ${yds(p.lateral.mean)} ${side}).`,
        );
      }
      const { sd_left: l, sd_right: r } = p.lateral;
      if (l > 0 && r > 0 && Math.max(l / r, r / l) >= BIG_MISS_RATIO) {
        const big = r > l ? 'right' : 'left';
        out.push(
          `${name}'s big miss is ${big} (spread ${Math.max(l / r, r / l).toFixed(1)}× the ` +
            `${big === 'right' ? 'left' : 'right'} side).`,
        );
      }
    }
    for (const b of conditionPatterns.filter((c) => c.clubId === clubId)) {
      const where = describeBucket(b.bucketKey);
      if (!where || b.nEffective < TENDENCY_MIN_SHOTS) continue;
      const right = probRight(b.params);
      if (Math.max(right, 1 - right) >= TENDENCY_MIN_SHARE) {
        out.push(
          `${name} misses ${right >= 0.5 ? 'right' : 'left'} ${pct(Math.max(right, 1 - right))} ${where}.`,
        );
      }
      const dd = b.params.distance.mean - p.distance.mean;
      if (p.distance.mean > 0 && Math.abs(dd) >= BUCKET_DISTANCE_FRAC * p.distance.mean) {
        out.push(`${name} goes ${yds(dd)} ${dd < 0 ? 'shorter' : 'longer'} ${where}.`);
      }
    }
  }

  const approaches = (opts.shots ?? []).filter(
    (s) =>
      s.source === 'course' &&
      !isPutt(s) &&
      !isPenaltyRecord(s) &&
      s.seq > 1 &&
      s.start !== null &&
      s.target !== null &&
      s.observedDistanceM !== null,
  );
  if (approaches.length >= TENDENCY_MIN_SHOTS) {
    const deltas = approaches.map(
      (s) => s.observedDistanceM! - haversineDistanceM(s.start!, s.target!),
    );
    const short = deltas.filter((d) => d < 0).length / deltas.length;
    if (Math.max(short, 1 - short) >= TENDENCY_MIN_SHARE) {
      const avg = deltas.reduce((t, d) => t + d, 0) / deltas.length;
      out.push(
        `Approaches finish ${short >= 0.5 ? 'short' : 'long'} ${pct(Math.max(short, 1 - short))} ` +
          `of the time (avg ${yds(avg)} ${avg < 0 ? 'short of' : 'past'} the target).`,
      );
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// WHS ledger (§10.3, §14)
// ---------------------------------------------------------------------------

export interface WhsLedgerEntry {
  roundId: string;
  courseId: string;
  date: string;
  gross: number | null;
  adjustedGross: number | null;
  differential: number;
  /** One of the lowest differentials averaged into the index. */
  counts: boolean;
}

export interface WhsLedger {
  /** The last ≤ 20 scores, newest first. */
  entries: WhsLedgerEntry[];
  /** CaddyMate's index (with soft/hard cap against the 365-day low), null with < 3 scores. */
  index: HandicapIndexResult | null;
  lowIndex365: number | null;
  /** `profiles.handicap_index_official`. */
  official: number | null;
  /** Index after each score (from the third), oldest first — for a trend line. */
  history: { date: string; index: number }[];
}

const DAY_MS = 86_400_000;

/**
 * The scoring record: complete rounds with a differential, the most recent
 * 20 with the ones that count marked, the app's index via `handicapIndex`
 * (soft/hard capped against the lowest index of the 365 days before the
 * latest score) and the official index from `profiles`.
 */
export async function whsLedger(db: Db, opts: { userId?: string } = {}): Promise<WhsLedger> {
  const rows = must(
    await db.from('rounds').select('*').eq('status', 'complete'),
    'whsLedger(rounds)',
  )
    .filter((r) => num(r.differential) !== null)
    .sort((a, b) => a.started_at.localeCompare(b.started_at));
  const userId = opts.userId ?? rows[0]?.user_id;
  const official = userId ? await officialIndex(db, userId) : null;

  const dated = rows.map((r) => ({ value: num(r.differential)!, date: r.started_at }));
  const history: { date: string; index: number }[] = [];
  for (let k = 3; k <= dated.length; k++) {
    const res = handicapIndex(dated.slice(0, k));
    if (res) history.push({ date: dated[k - 1]!.date, index: res.index });
  }
  const last = dated.at(-1);
  let lowIndex365: number | null = null;
  if (last) {
    const t = Date.parse(last.date);
    const prior = history.filter(
      (h) => Date.parse(h.date) < t && t - Date.parse(h.date) <= 365 * DAY_MS,
    );
    if (prior.length) lowIndex365 = Math.min(...prior.map((h) => h.index));
  }
  const index = handicapIndex(dated, lowIndex365 ?? undefined);

  const recent = rows.slice(-20).reverse();
  const used = whsScoreTable(recent.length)?.used ?? 0;
  const counting = new Set(
    recent
      .map((r, i) => ({ v: num(r.differential)!, i }))
      .sort((a, b) => a.v - b.v || a.i - b.i)
      .slice(0, used)
      .map((x) => x.i),
  );
  return {
    entries: recent.map((r, i) => ({
      roundId: r.round_id,
      courseId: r.course_id,
      date: r.started_at,
      gross: r.gross,
      adjustedGross: r.adjusted_gross,
      differential: num(r.differential)!,
      counts: counting.has(i),
    })),
    index,
    lowIndex365,
    official,
    history,
  };
}
