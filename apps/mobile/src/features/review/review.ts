/**
 * Post-round review helpers (docs/SPEC.md §9.5, §10, §14): the round review
 * from the local store, replay geometry per shot, trend aggregations and
 * chart scaling. Pure — hooks live in ./useReview, charts in
 * components/review.
 */
import {
  buildRoundReview,
  isPenaltyRecord,
  reviewBaseline,
  type Club,
  type CourseBundle,
  type HoleScore,
  type ReviewHole,
  type ReviewShot,
  type Round,
  type RoundReview,
  type RoundReviewSummary,
  type Shot,
  type StoredClubPattern,
} from '@caddymate/api';
import {
  ellipsePolygon,
  fromClubFrame,
  haversineDistanceM,
  initialBearingDeg,
  rollingSg,
  toClubFrame,
  type ClubPattern,
  type FrameResult,
  type LatLng,
  type SgCategory,
} from '@caddymate/engine';

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

export const CATEGORY_LABEL: Record<SgCategory, string> = {
  ott: 'Off the tee',
  app: 'Approach',
  arg: 'Around the green',
  putt: 'Putting',
};

/** "+0.42" / "−1.10" / "0.00". */
export function fmtSg(x: number | null | undefined, dp = 2): string {
  if (x === null || x === undefined || !Number.isFinite(x)) return '–';
  const r = Number(x.toFixed(dp));
  if (r === 0) return (0).toFixed(dp);
  return `${r > 0 ? '+' : '−'}${Math.abs(r).toFixed(dp)}`;
}

// ---------------------------------------------------------------------------
// Round review from local data
// ---------------------------------------------------------------------------

export interface LocalReviewInput {
  round: Round;
  bundle: CourseBundle;
  scores: readonly HoleScore[];
  shots: readonly Shot[];
  clubs: readonly Club[];
  patterns: readonly StoredClubPattern[];
  /** Profile's official index: baseline fallback when the round has none. */
  officialIndex: number | null;
}

export function localRoundReview(input: LocalReviewInput): RoundReview {
  return buildRoundReview({
    round: input.round,
    holeScores: input.scores,
    shots: input.shots,
    pars: Object.fromEntries(input.bundle.holes.map((h) => [h.number, h.par])),
    baseline: reviewBaseline(input.round, input.officialIndex),
    patterns: new Map(input.patterns.map((p) => [p.clubId, p.params])),
    clubLabels: Object.fromEntries(input.clubs.map((c) => [c.id, c.name])),
  });
}

// ---------------------------------------------------------------------------
// Replay
// ---------------------------------------------------------------------------

/**
 * The 80 % ellipse of a club's neutral pattern drawn along start → aim,
 * re-centred on `meanLanding` (the snapshot's conditioned mean) when given,
 * so it sits where the engine expected the ball at the time.
 */
export function shotEllipse(
  start: LatLng,
  aim: LatLng,
  pattern: ClubPattern,
  meanLanding: LatLng | null = null,
): LatLng[] {
  const bearing = initialBearingDeg(start, aim);
  let p = pattern;
  if (meanLanding) {
    const m = toClubFrame(start, bearing, meanLanding);
    p = {
      ...pattern,
      distance: { ...pattern.distance, mean: m.alongM },
      lateral: { ...pattern.lateral, mean: m.lateralM },
    };
  }
  return ellipsePolygon(p, 0.8, 48).map((r) => fromClubFrame(start, bearing, r));
}

export interface ReplayShot {
  id: string;
  seq: number;
  clubLabel: string | null;
  start: LatLng | null;
  end: LatLng | null;
  /** The chosen aim at Hit (snapshot), else the stored target. */
  aim: LatLng | null;
  /** The cone shown at the time (snapshot ellipse), else re-derived from the pattern. */
  ellipse: LatLng[] | null;
  ellipseSource: 'snapshot' | 'pattern' | null;
  review: ReviewShot;
}

/** Replay frames for one hole: every real shot with its aim and ellipse. */
export function replayShots(
  hole: ReviewHole,
  patterns: ReadonlyMap<string, ClubPattern>,
  labels: Readonly<Record<string, string>>,
): ReplayShot[] {
  return hole.shots
    .filter((r) => !isPenaltyRecord(r.shot))
    .map((r) => {
      const s = r.shot;
      const chosen = s.recommendation?.chosen ?? null;
      const aim = chosen?.aim ?? s.target;
      let ellipse: LatLng[] | null = null;
      let ellipseSource: ReplayShot['ellipseSource'] = null;
      // Snapshots omit the ellipse (decision 004); honour one if a future version keeps it.
      const stored = (chosen as { ellipse80?: LatLng[] } | null)?.ellipse80;
      if (stored && stored.length > 2) {
        ellipse = stored;
        ellipseSource = 'snapshot';
      } else {
        const pattern = s.clubId ? patterns.get(s.clubId) : undefined;
        if (s.start && aim && pattern && s.lie !== 'green') {
          ellipse = shotEllipse(s.start, aim, pattern, chosen?.meanLanding ?? null);
          ellipseSource = 'pattern';
        }
      }
      return {
        id: s.id,
        seq: s.seq,
        clubLabel: s.clubId ? (labels[s.clubId] ?? null) : null,
        start: s.start,
        end: s.end,
        aim,
        ellipse,
        ellipseSource,
        review: r,
      };
    });
}

/** [minLng, minLat, maxLng, maxLat] of the points, or null. */
export function boundsOf(points: readonly LatLng[]): [number, number, number, number] | null {
  if (!points.length) return null;
  const lats = points.map((p) => p.lat);
  const lngs = points.map((p) => p.lng);
  return [Math.min(...lngs), Math.min(...lats), Math.max(...lngs), Math.max(...lats)];
}

/** Camera fit for a hole: tee, line of play, green and the shots; bearing tee → green. */
export function holeView(
  bundle: CourseBundle,
  round: Round,
  holeNumber: number,
  shots: readonly Pick<Shot, 'start' | 'end'>[] = [],
): { bounds: [number, number, number, number]; bearing: number } | null {
  const h = bundle.holes.find((x) => x.number === holeNumber);
  if (!h) return null;
  const tee = bundle.teeSets
    .find((t) => t.id === round.teeSetId)
    ?.markers.find((m) => m.holeId === h.id)?.point;
  const pts: LatLng[] = [
    ...(tee ? [tee] : []),
    ...(h.lineOfPlay ?? []),
    ...(h.green?.outer ?? []),
    ...(h.greenCentre ? [h.greenCentre] : []),
    ...shots.flatMap((s) => [s.start, s.end].filter((p): p is LatLng => p !== null)),
  ];
  const bounds = boundsOf(pts);
  if (!bounds) return null;
  const from = tee ?? h.lineOfPlay?.[0] ?? null;
  return { bounds, bearing: from && h.greenCentre ? initialBearingDeg(from, h.greenCentre) : 0 };
}

// ---------------------------------------------------------------------------
// Trends
// ---------------------------------------------------------------------------

export interface RollingPoint {
  roundId: string;
  startedAt: string;
  n: number;
  total: number;
  byCategory: Record<SgCategory, number>;
}

/** Trailing per-round mean SG over `window` rounds; summaries oldest first. */
export function rollingSeries(
  summaries: readonly RoundReviewSummary[],
  window: number,
): RollingPoint[] {
  return rollingSg(
    summaries.map((s) => s.sg),
    window,
  ).map((p, i) => ({
    ...p,
    roundId: summaries[i]!.roundId,
    startedAt: summaries[i]!.startedAt,
  }));
}

export interface HoleAverage {
  number: number;
  par: number;
  n: number;
  avgStrokes: number;
  avgToPar: number;
  avgSg: number;
}

/** Scoring average and SG per hole at a course over the given rounds. */
export function holeAverages(
  summaries: readonly RoundReviewSummary[],
  courseId: string,
): HoleAverage[] {
  const acc = new Map<number, { par: number; n: number; strokes: number; sg: number }>();
  for (const s of summaries) {
    if (s.courseId !== courseId) continue;
    for (const h of s.holes) {
      if (h.strokes === null) continue;
      const a = acc.get(h.number) ?? { par: h.par, n: 0, strokes: 0, sg: 0 };
      a.n += 1;
      a.strokes += h.strokes;
      a.sg += h.sg;
      acc.set(h.number, a);
    }
  }
  return [...acc.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([number, a]) => ({
      number,
      par: a.par,
      n: a.n,
      avgStrokes: a.strokes / a.n,
      avgToPar: a.strokes / a.n - a.par,
      avgSg: a.sg / a.n,
    }));
}

/** Courses by number of rounds, most played first. */
export function coursesPlayed(
  summaries: readonly RoundReviewSummary[],
): { courseId: string; name: string; rounds: number }[] {
  const acc = new Map<string, { name: string; rounds: number }>();
  for (const s of summaries) {
    const a = acc.get(s.courseId) ?? { name: s.courseName ?? 'Course', rounds: 0 };
    a.rounds += 1;
    acc.set(s.courseId, a);
  }
  return [...acc.entries()]
    .map(([courseId, a]) => ({ courseId, ...a }))
    .sort((a, b) => b.rounds - a.rounds);
}

export interface TeeClubOutcome {
  clubId: string;
  label: string;
  n: number;
  avgSg: number;
  fairwayPct: number;
  penaltyPct: number;
  /** Mean distance left for the next shot (holed tee shots excluded). */
  avgRemainingM: number | null;
  /** Share of these tee shots where the engine's best option was this club. */
  recommendedPct: number;
}

export interface TeeHoleComparison {
  courseId: string;
  holeNumber: number;
  par: number;
  clubs: TeeClubOutcome[];
}

const FAIRWAY_LIES = new Set(['fairway', 'first_cut']);

/**
 * Tee-strategy comparison (§14): per par-4/5 hole of a course, the actual
 * outcomes of each club hit off the tee (driver vs 5-wood vs hybrid…), best
 * average SG first.
 */
export function teeStrategy(
  summaries: readonly RoundReviewSummary[],
  courseId: string,
): TeeHoleComparison[] {
  const holes = new Map<number, { par: number; byClub: Map<string, TeeClubAcc> }>();
  for (const s of summaries) {
    if (s.courseId !== courseId) continue;
    for (const t of s.teeShots) {
      if (t.par < 4 || !t.clubId) continue;
      const h = holes.get(t.holeNumber) ?? { par: t.par, byClub: new Map() };
      holes.set(t.holeNumber, h);
      const a = h.byClub.get(t.clubId) ?? newTeeAcc(t.clubLabel ?? t.clubId);
      h.byClub.set(t.clubId, a);
      a.n += 1;
      a.sg += t.sg;
      if (t.resultSurface && FAIRWAY_LIES.has(t.resultSurface) && !t.penalty) a.fairway += 1;
      if (t.penalty) a.penalty += 1;
      if (t.remainingM !== null) {
        a.remaining += t.remainingM;
        a.nRemaining += 1;
      }
      if (t.recommendedClubId === t.clubId) a.recommended += 1;
    }
  }
  return [...holes.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([holeNumber, h]) => ({
      courseId,
      holeNumber,
      par: h.par,
      clubs: [...h.byClub.entries()]
        .map(([clubId, a]) => ({
          clubId,
          label: a.label,
          n: a.n,
          avgSg: a.sg / a.n,
          fairwayPct: a.fairway / a.n,
          penaltyPct: a.penalty / a.n,
          avgRemainingM: a.nRemaining ? a.remaining / a.nRemaining : null,
          recommendedPct: a.recommended / a.n,
        }))
        .sort((a, b) => b.avgSg - a.avgSg),
    }));
}

interface TeeClubAcc {
  label: string;
  n: number;
  sg: number;
  fairway: number;
  penalty: number;
  remaining: number;
  nRemaining: number;
  recommended: number;
}

const newTeeAcc = (label: string): TeeClubAcc => ({
  label,
  n: 0,
  sg: 0,
  fairway: 0,
  penalty: 0,
  remaining: 0,
  nRemaining: 0,
  recommended: 0,
});

// ---------------------------------------------------------------------------
// Chart scaling
// ---------------------------------------------------------------------------

export interface Domain {
  min: number;
  max: number;
}

/** A padded domain that includes every value (and `include`, e.g. 0); never empty. */
export function niceDomain(values: readonly number[], include: readonly number[] = []): Domain {
  const all = [...values, ...include].filter(Number.isFinite);
  if (!all.length) return { min: 0, max: 1 };
  let min = Math.min(...all);
  let max = Math.max(...all);
  if (max - min < 1e-9) {
    min -= 1;
    max += 1;
  }
  const pad = (max - min) * 0.08;
  return { min: min - pad, max: max + pad };
}

/** Linear map of a domain onto [r0, r1]. */
export const scale =
  (d: Domain, r0: number, r1: number) =>
  (v: number): number =>
    r0 + ((v - d.min) / (d.max - d.min)) * (r1 - r0);

/**
 * Square domain for a dispersion scatter (lateral on x, along on y) around
 * all points and rings, so the ellipse is not distorted.
 */
export function scatterDomains(
  points: readonly FrameResult[],
  rings: readonly (readonly FrameResult[])[],
): { x: Domain; y: Domain } {
  const all = [...points, ...rings.flat()];
  const x = niceDomain(
    all.map((p) => p.lateralM),
    [0],
  );
  const y = niceDomain(all.map((p) => p.alongM));
  const span = Math.max(x.max - x.min, y.max - y.min);
  const cx = (x.max + x.min) / 2;
  const cy = (y.max + y.min) / 2;
  return {
    x: { min: cx - span / 2, max: cx + span / 2 },
    y: { min: cy - span / 2, max: cy + span / 2 },
  };
}

/** The shot in a review hole a worst-five entry refers to. */
export function findReviewShot(review: RoundReview, shotId: string): ReviewShot | null {
  for (const h of review.holes) {
    const r = h.shots.find((x) => x.shot.id === shotId);
    if (r) return r;
  }
  return null;
}

/** "Hole 7 · shot 2 · 7i". */
export function shotTitle(holeNumber: number, seq: number, clubLabel: string | null): string {
  return `Hole ${String(holeNumber)} · shot ${String(seq)}${clubLabel ? ` · ${clubLabel}` : ''}`;
}

/** Straight-line length of a shot, metres (null without both ends). */
export function shotLengthM(s: Pick<Shot, 'start' | 'end'>): number | null {
  return s.start && s.end ? haversineDistanceM(s.start, s.end) : null;
}
