import type { LatLng } from '@caddymate/engine';
import type { Db } from './client.js';
import { check, must, mustMaybe, num } from './errors.js';
import { uuidv4 } from './uuid.js';
import type { HoleScore, Json, Round, Row, Tables, WeatherSnapshot } from './types.js';

function parsePins(v: Json): Record<string, LatLng> {
  const out: Record<string, LatLng> = {};
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    for (const [k, p] of Object.entries(v)) {
      if (p && typeof p === 'object' && !Array.isArray(p)) {
        const lat = num(p.lat);
        const lng = num(p.lng);
        if (lat !== null && lng !== null) out[k] = { lat, lng };
      }
    }
  }
  return out;
}

export function roundFromRow(r: Row<'rounds'>): Round {
  return {
    id: r.round_id,
    userId: r.user_id,
    courseId: r.course_id,
    courseVersion: r.course_version,
    teeSetId: r.tee_set_id,
    startedAt: r.started_at,
    finishedAt: r.finished_at,
    status: r.status,
    weatherSnapshot: (r.weather_snapshot as unknown as WeatherSnapshot | null) ?? null,
    pinOverrides: parsePins(r.pin_overrides),
    handicapIndexUsed: num(r.handicap_index_used),
    courseHandicap: r.course_handicap,
    playingHandicap: r.playing_handicap,
    gross: r.gross,
    adjustedGross: r.adjusted_gross,
    stableford: r.stableford,
    differential: num(r.differential),
  };
}

export function roundToRow(r: Round): Tables['rounds']['Insert'] {
  return {
    round_id: r.id,
    user_id: r.userId,
    course_id: r.courseId,
    course_version: r.courseVersion,
    tee_set_id: r.teeSetId,
    started_at: r.startedAt,
    finished_at: r.finishedAt,
    status: r.status,
    weather_snapshot: r.weatherSnapshot as unknown as Json,
    pin_overrides: r.pinOverrides as unknown as NonNullable<Json>,
    handicap_index_used: r.handicapIndexUsed,
    course_handicap: r.courseHandicap,
    playing_handicap: r.playingHandicap,
    gross: r.gross,
    adjusted_gross: r.adjustedGross,
    stableford: r.stableford,
    differential: r.differential,
  };
}

export function holeScoreFromRow(r: Row<'hole_scores'>): HoleScore {
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

export function holeScoreToRow(s: HoleScore): Tables['hole_scores']['Insert'] {
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

export interface StartRoundInput {
  /** Client-generated id so a local-first store can reference it before sync. */
  id?: string;
  userId: string;
  courseId: string;
  courseVersion: number;
  teeSetId: string;
  startedAt?: string;
  weatherSnapshot?: WeatherSnapshot | null;
  handicapIndexUsed?: number | null;
  courseHandicap?: number | null;
  playingHandicap?: number | null;
}

/** Build the Round object for a new live round without touching the network. */
export function newRound(input: StartRoundInput & { id: string }): Round {
  return {
    id: input.id,
    userId: input.userId,
    courseId: input.courseId,
    courseVersion: input.courseVersion,
    teeSetId: input.teeSetId,
    startedAt: input.startedAt ?? new Date().toISOString(),
    finishedAt: null,
    status: 'live',
    weatherSnapshot: input.weatherSnapshot ?? null,
    pinOverrides: {},
    handicapIndexUsed: input.handicapIndexUsed ?? null,
    courseHandicap: input.courseHandicap ?? null,
    playingHandicap: input.playingHandicap ?? null,
    gross: null,
    adjustedGross: null,
    stableford: null,
    differential: null,
  };
}

export async function startRound(db: Db, input: StartRoundInput): Promise<Round> {
  const row = roundToRow(newRound({ ...input, id: input.id ?? uuidv4() }));
  const data = must(await db.from('rounds').insert(row).select('*').single(), 'startRound');
  return roundFromRow(data);
}

/** Idempotent write of a whole round row (used by the mobile sync queue). */
export async function upsertRound(db: Db, round: Round): Promise<void> {
  check(
    await db.from('rounds').upsert(roundToRow(round), { onConflict: 'round_id' }),
    'upsertRound',
  );
}

export interface FinishRoundTotals {
  gross: number | null;
  adjustedGross?: number | null;
  stableford?: number | null;
  differential?: number | null;
  status?: 'complete' | 'abandoned';
}

export async function finishRound(
  db: Db,
  roundId: string,
  totals: FinishRoundTotals,
): Promise<Round> {
  const data = must(
    await db
      .from('rounds')
      .update({
        status: totals.status ?? 'complete',
        finished_at: new Date().toISOString(),
        gross: totals.gross,
        adjusted_gross: totals.adjustedGross ?? null,
        stableford: totals.stableford ?? null,
        differential: totals.differential ?? null,
      })
      .eq('round_id', roundId)
      .select('*')
      .single(),
    'finishRound',
  );
  return roundFromRow(data);
}

export interface RoundListItem extends Round {
  courseName: string | null;
}

export async function listRounds(db: Db, opts: { limit?: number } = {}): Promise<RoundListItem[]> {
  const rows = must(
    await db
      .from('rounds')
      .select('*, courses(name)')
      .order('started_at', { ascending: false })
      .limit(opts.limit ?? 20),
    'listRounds',
  );
  return rows.map((r) => ({ ...roundFromRow(r), courseName: r.courses?.name ?? null }));
}

export interface RoundWithScores {
  round: Round;
  holeScores: HoleScore[];
}

export async function getRound(db: Db, roundId: string): Promise<RoundWithScores | null> {
  const row = mustMaybe(
    await db.from('rounds').select('*, hole_scores(*)').eq('round_id', roundId).maybeSingle(),
    'getRound',
  );
  if (!row) return null;
  return {
    round: roundFromRow(row),
    holeScores: row.hole_scores.map(holeScoreFromRow).sort((a, b) => a.holeNumber - b.holeNumber),
  };
}

export async function upsertHoleScores(db: Db, scores: HoleScore[]): Promise<void> {
  if (!scores.length) return;
  check(
    await db
      .from('hole_scores')
      .upsert(scores.map(holeScoreToRow), { onConflict: 'round_id,hole_number' }),
    'upsertHoleScores',
  );
}

export async function setPinOverride(
  db: Db,
  round: Round,
  holeNumber: number,
  pin: LatLng | null,
): Promise<Round> {
  const key = String(holeNumber);
  const pins = Object.fromEntries(Object.entries(round.pinOverrides).filter(([k]) => k !== key));
  if (pin) pins[key] = pin;
  const data = must(
    await db
      .from('rounds')
      .update({ pin_overrides: pins as unknown as NonNullable<Json> })
      .eq('round_id', round.id)
      .select('*')
      .single(),
    'setPinOverride',
  );
  return roundFromRow(data);
}
