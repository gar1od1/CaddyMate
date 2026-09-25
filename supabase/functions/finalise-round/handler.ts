/**
 * `POST /finalise-round { roundId }` — server-side end of a round:
 *  1. re-derive every hole with `recomputeHoleShots` (mirror of the device
 *     code: re-chain, renumber, observed/neutral, distances to the pin) and
 *     write back only the derived columns that changed;
 *  2. `tallyHole` → `hole_scores` (manual overrides kept), `rounds.gross`
 *     (Σ override-or-logged strokes), status `complete` if still live;
 *  3. the authoritative refit (§8.8) of every club used in the round.
 * Strokes gained and grades are NOT computed here (see `reviewRoundHook`).
 */
import type { LatLng } from '../_shared/engine/index.ts';
import {
  applyTally,
  holeStrokes,
  isPenaltyRecord,
  recomputeHoleShots,
  tallyHole,
} from '../_shared/hole.ts';
import { HttpError, json } from '../_shared/http.ts';
import { clubProfile, refitClubs, type ClubRefitResult } from '../_shared/refit.ts';
import {
  derivedShotPatch,
  holeScoreFromRow,
  holeScoreToRow,
  shotFromRow,
  type DerivedShotPatch,
} from '../_shared/shots.ts';
import { type FinaliseStore, isUuid, pinsForRound, readJson } from '../_shared/store.ts';
import type { HoleScore, LieKind, Shot } from '../_shared/types.ts';

/** Offset used to park seqs while renumbering (as @caddymate/api `upsertHoleShots`). */
export const SEQ_PARK = 1000;

export interface FinaliseDeps {
  authenticate(req: Request): Promise<{ userId: string; store: FinaliseStore }>;
  now(): Date;
  /**
   * TODO(review): strokes gained, SG categories and decision/execution grades
   * (§9.5, §10.1) are computed on device by the review flow and written from
   * there. If they move server-side, compute and store them here, after the
   * hole re-derivation and before the refit. No-op by default.
   */
  reviewRoundHook?(roundId: string, shots: readonly Shot[]): Promise<void>;
}

export interface FinaliseHole {
  holeNumber: number;
  strokes: number;
  strokesLogged: number;
  putts: number;
  penalties: number;
  holed: boolean;
}

export interface FinaliseResponse {
  roundId: string;
  gross: number | null;
  status: 'live' | 'complete' | 'abandoned';
  holes: FinaliseHole[];
  shotsUpdated: number;
  clubsRefit: ClubRefitResult[];
}

const ptKey = (p: LatLng) => `${p.lat},${p.lng}`;

/**
 * Surfaces already known for points: where a stored shot ended (its
 * `result_surface`) and where the next shot was played from (its `lie`).
 * Hole features are not loaded server-side, so the device's surface
 * classification is kept rather than recomputed.
 */
export function storedSurfaces(shots: readonly Shot[]): (p: LatLng) => LieKind | null {
  const m = new Map<string, LieKind>();
  for (const s of shots) if (s.start && s.lie) m.set(ptKey(s.start), s.lie);
  for (const s of shots) if (s.end && s.resultSurface) m.set(ptKey(s.end), s.resultSurface);
  return (p) => m.get(ptKey(p)) ?? null;
}

export async function finaliseRound(
  store: FinaliseStore,
  userId: string,
  roundId: string,
  deps: Pick<FinaliseDeps, 'now' | 'reviewRoundHook'>,
): Promise<FinaliseResponse> {
  const round = await store.round(roundId);
  if (!round || round.user_id !== userId) throw new HttpError(404, 'not_found', 'Round not found');

  const [rows, greens, clubs, profile] = await Promise.all([
    store.roundShots(roundId),
    store.greenCentres(round.course_id, round.course_version),
    store.clubs(),
    store.profile(userId),
  ]);
  const pins = pinsForRound(round.pin_overrides, greens);
  const clubById = new Map(clubs.map((c) => [c.club_id, c]));
  const byHole = new Map<number, Shot[]>();
  for (const s of rows.map(shotFromRow).filter((s) => s.source === 'course')) {
    const list = byHole.get(s.holeNumber) ?? [];
    list.push(s);
    byHole.set(s.holeNumber, list);
  }

  const prevScores = new Map(round.hole_scores.map((h) => [h.hole_number, holeScoreFromRow(h)]));
  const scores = new Map<number, HoleScore>(prevScores);
  const tallies = new Map<number, ReturnType<typeof tallyHole>>();
  const allShots: Shot[] = [];
  let shotsUpdated = 0;

  for (const [holeNumber, before] of [...byHole].sort((a, b) => a[0] - b[0])) {
    const after = recomputeHoleShots(before, {
      pin: pins.get(holeNumber) ?? null,
      surfaceAt: storedSurfaces(before),
      clubFor: (id) => {
        const c = clubById.get(id);
        return c ? clubProfile(c) : null;
      },
      handedness: profile?.handedness ?? 'R',
    });
    const orig = new Map(before.map((s) => [s.id, s]));
    const patches: { shot: Shot; patch: DerivedShotPatch }[] = [];
    for (const s of after) {
      const patch = derivedShotPatch(orig.get(s.id)!, s);
      if (patch) patches.push({ shot: s, patch });
    }
    // (round_id, hole_number, seq) is unique: park renumbered shots first.
    for (const { shot, patch } of patches) {
      if (patch.seq !== undefined) await store.updateShot(shot.id, { seq: shot.seq + SEQ_PARK });
    }
    for (const { shot, patch } of patches) await store.updateShot(shot.id, patch);
    shotsUpdated += patches.length;

    const tally = tallyHole(after);
    tallies.set(holeNumber, tally);
    scores.set(
      holeNumber,
      applyTally(prevScores.get(holeNumber) ?? null, roundId, holeNumber, tally),
    );
    allShots.push(...after);
  }

  const scoreList = [...scores.values()].sort((a, b) => a.holeNumber - b.holeNumber);
  await store.upsertHoleScores(
    scoreList.filter((s) => byHole.has(s.holeNumber)).map(holeScoreToRow),
  );
  const gross = scoreList.length ? scoreList.reduce((t, s) => t + holeStrokes(s), 0) : null;
  const now = deps.now();
  const status = round.status === 'live' ? 'complete' : round.status;
  await store.updateRound(roundId, {
    gross,
    ...(round.status === 'live' ? { status: 'complete' as const } : {}),
    ...(round.finished_at === null ? { finished_at: now.toISOString() } : {}),
  });

  await deps.reviewRoundHook?.(roundId, allShots);

  const clubIds = [
    ...new Set(allShots.filter((s) => s.clubId && !isPenaltyRecord(s)).map((s) => s.clubId!)),
  ];
  const refit = clubIds.length ? await refitClubs(store, userId, { clubIds, now }) : null;

  return {
    roundId,
    gross,
    status,
    holes: scoreList.map((s) => ({
      holeNumber: s.holeNumber,
      strokes: holeStrokes(s),
      strokesLogged: s.strokesLogged,
      putts: s.putts,
      penalties: s.penalties,
      holed: tallies.get(s.holeNumber)?.holed ?? false,
    })),
    shotsUpdated,
    clubsRefit: refit?.clubs ?? [],
  };
}

export async function handleFinaliseRound(req: Request, deps: FinaliseDeps): Promise<Response> {
  if (req.method !== 'POST') throw new HttpError(405, 'method_not_allowed', 'Use POST');
  const { userId, store } = await deps.authenticate(req);
  const body = await readJson(req);
  if (!isUuid(body.roundId)) throw new HttpError(400, 'bad_request', 'roundId must be a uuid');
  return json(await finaliseRound(store, userId, body.roundId, deps));
}
