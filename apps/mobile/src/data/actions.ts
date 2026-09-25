/**
 * Local-first write operations for a round. Each writes SQLite, recomputes
 * the hole with the shared pure `recomputeHoleShots` / `tallyHole` from
 * @caddymate/api, and enqueues a sync.
 */
import {
  applyTally,
  holeStrokes,
  newRound,
  recomputeHoleShots,
  stablefordPoints,
  strokesReceived,
  surfaceAt,
  tallyHole,
  uuidv4,
  type CourseBundle,
  type HoleScore,
  type Round,
  type Shot,
  type StartRoundInput,
} from '@caddymate/api';
import type { LatLng } from '@caddymate/engine';
import * as local from './local';
import { enqueue } from './sync';

export function pinFor(round: Round, bundle: CourseBundle, hole: number): LatLng | null {
  return (
    round.pinOverrides[String(hole)] ??
    bundle.holes.find((h) => h.number === hole)?.greenCentre ??
    null
  );
}

export function strokeIndexFor(round: Round, bundle: CourseBundle, hole: number): number | null {
  const holeId = bundle.holes.find((h) => h.number === hole)?.id;
  const tee = bundle.teeSets.find((t) => t.id === round.teeSetId);
  return tee?.markers.find((m) => m.holeId === holeId)?.strokeIndex ?? null;
}

/** Points and net strokes for a hole score (placeholder scoring, see @caddymate/api/scoring). */
function scoreHole(score: HoleScore, round: Round, bundle: CourseBundle): HoleScore {
  const hole = bundle.holes.find((h) => h.number === score.holeNumber);
  const strokes = holeStrokes(score);
  if (!hole || strokes === 0) return { ...score, points: null, netStrokes: null };
  const si = strokeIndexFor(round, bundle, score.holeNumber);
  const received =
    round.playingHandicap !== null && si !== null ? strokesReceived(round.playingHandicap, si) : 0;
  return {
    ...score,
    // TODO(wave-2): use engine scoring
    points: stablefordPoints(hole.par, strokes, received),
    netStrokes: strokes - received,
  };
}

export async function createRound(input: StartRoundInput): Promise<Round> {
  const round = newRound({ ...input, id: input.id ?? uuidv4() });
  await local.putRound(round);
  await enqueue('round', round.id);
  return round;
}

export async function saveRound(round: Round): Promise<void> {
  await local.putRound(round);
  await enqueue('round', round.id);
}

/**
 * Persist a hole's full shot list: re-chain + re-derive, recount the score,
 * write locally (with tombstones for removed shots) and queue the push.
 */
export async function saveHole(
  round: Round,
  bundle: CourseBundle,
  hole: number,
  shots: readonly Shot[],
): Promise<Shot[]> {
  const recomputed = recomputeHoleShots(shots, {
    pin: pinFor(round, bundle, hole),
    surfaceAt: (p) => surfaceAt(bundle.holes, p, hole).lie,
  });
  const prev = await local.getHoleScore(round.id, hole);
  const score = scoreHole(applyTally(prev, round.id, hole, tallyHole(recomputed)), round, bundle);
  await local.replaceHole(round.id, hole, recomputed, score);
  await enqueue('hole', round.id, hole);
  return recomputed;
}

export async function setStrokeOverride(
  round: Round,
  bundle: CourseBundle,
  hole: number,
  strokes: number | null,
  reason: string | null,
): Promise<void> {
  const prev =
    (await local.getHoleScore(round.id, hole)) ??
    applyTally(null, round.id, hole, tallyHole(await local.getHoleShots(round.id, hole)));
  const score = scoreHole(
    { ...prev, strokesOverride: strokes, overrideReason: strokes === null ? null : reason },
    round,
    bundle,
  );
  await local.putHoleScore(score);
  await enqueue('hole', round.id, hole);
}

export async function setPin(
  round: Round,
  bundle: CourseBundle,
  hole: number,
  pin: LatLng | null,
): Promise<Round> {
  const key = String(hole);
  const pins = Object.fromEntries(Object.entries(round.pinOverrides).filter(([k]) => k !== key));
  if (pin) pins[key] = pin;
  const next = { ...round, pinOverrides: pins };
  await saveRound(next);
  // Pin moves change distances-to-pin and holed end points.
  await saveHole(next, bundle, hole, await local.getHoleShots(round.id, hole));
  return next;
}
