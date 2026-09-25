/**
 * Push queue: local writes enqueue a *key* ("round:<id>" or
 * "hole:<id>:<n>"); flushing reads the current local state for that key and
 * pushes it idempotently, so repeated edits coalesce and a retry after a
 * dropped packet can never lose or duplicate a shot. Rounds flush before
 * holes (shots reference the round). Failed items back off exponentially.
 */
import {
  deleteShots,
  fitAndStoreClubPattern,
  getRound as getRemoteRound,
  listClubConditionPatterns,
  listClubPatterns,
  listShots,
  upsertHoleScores,
  upsertHoleShots,
  upsertRound,
  type Club,
  type Shot,
} from '@caddymate/api';
import { AppState } from 'react-native';
import { supabase } from '@/lib/supabase';
import { localDb } from './db';
import { notifyChange } from './events';
import * as local from './local';

type Kind = 'round' | 'hole';

interface QueueRow {
  key: string;
  kind: Kind;
  round_id: string;
  hole_number: number | null;
  version: number;
  attempts: number;
  next_at: number;
  last_error: string | null;
}

/** kv keys of the cached pattern lists (read by the hooks). */
export const PATTERNS_KEY = 'patterns';
export const CONDITION_PATTERNS_KEY = 'conditionPatterns';

const MAX_BACKOFF_MS = 60_000;
const POLL_MS = 15_000;

export async function enqueue(kind: Kind, roundId: string, hole?: number): Promise<void> {
  const db = await localDb();
  const key = kind === 'round' ? `round:${roundId}` : `hole:${roundId}:${String(hole)}`;
  await db.runAsync(
    `INSERT INTO sync_queue (key, kind, round_id, hole_number, version, attempts, next_at, created_at)
     VALUES (?, ?, ?, ?, 0, 0, 0, ?)
     ON CONFLICT(key) DO UPDATE SET version = version + 1, attempts = 0, next_at = 0, last_error = NULL`,
    key,
    kind,
    roundId,
    hole ?? null,
    Date.now(),
  );
  notifyChange();
  kick();
}

async function push(item: QueueRow): Promise<void> {
  if (item.kind === 'round') {
    const round = await local.getRound(item.round_id);
    if (round) await upsertRound(supabase, round);
    return;
  }
  const hole = item.hole_number ?? 0;
  const [shots, tomb, score] = await Promise.all([
    local.getHoleShots(item.round_id, hole),
    local.getTombstones(item.round_id, hole),
    local.getHoleScore(item.round_id, hole),
  ]);
  await deleteShots(supabase, tomb);
  await upsertHoleShots(supabase, shots);
  if (score) await upsertHoleScores(supabase, [score]);
  await local.clearTombstones(tomb);
  refitInBackground(item.round_id, shots);
}

/**
 * Incremental refit on the device after the hole's shots are pushed
 * (docs/SPEC.md §8.8): every club with a neutral result on the hole is
 * refitted from all its shots and the cached pattern lists are refreshed.
 * Best effort; the Edge Function refit after the round is authoritative.
 */
function refitInBackground(roundId: string, shots: readonly Shot[]): void {
  const clubIds = [
    ...new Set(shots.filter((s) => s.neutralDistanceM !== null && s.clubId).map((s) => s.clubId!)),
  ];
  const userId = shots[0]?.userId;
  if (!clubIds.length || !userId) return;
  void (async () => {
    const [round, clubs] = await Promise.all([
      local.getRound(roundId),
      local.kvGet<Club[]>('clubs'),
    ]);
    for (const id of clubIds) {
      const club = clubs?.find((c) => c.id === id);
      await fitAndStoreClubPattern(supabase, userId, id, {
        ...(club ? { club } : {}),
        handicapIndex: round?.handicapIndexUsed ?? null,
      });
    }
    await local.kvSet(PATTERNS_KEY, await listClubPatterns(supabase));
    await local.kvSet(CONDITION_PATTERNS_KEY, await listClubConditionPatterns(supabase));
  })().catch(() => undefined);
}

let running: Promise<void> | null = null;

/** Push everything that is due. Safe to call often; concurrent calls share one run. */
export function flush(): Promise<void> {
  running ??= (async () => {
    try {
      const { data } = await supabase.auth.getSession();
      if (!data.session) return;
      const db = await localDb();
      const due = await db.getAllAsync<QueueRow>(
        `SELECT * FROM sync_queue WHERE next_at <= ?
         ORDER BY CASE kind WHEN 'round' THEN 0 ELSE 1 END, created_at`,
        Date.now(),
      );
      const failedRounds = new Set<string>();
      for (const item of due) {
        if (failedRounds.has(item.round_id)) continue;
        try {
          await push(item);
          // Only drop the entry if nothing re-enqueued it while we pushed.
          await db.runAsync(
            'DELETE FROM sync_queue WHERE key = ? AND version = ?',
            item.key,
            item.version,
          );
        } catch (e) {
          if (item.kind === 'round') failedRounds.add(item.round_id);
          const attempts = item.attempts + 1;
          await db.runAsync(
            'UPDATE sync_queue SET attempts = ?, next_at = ?, last_error = ? WHERE key = ?',
            attempts,
            Date.now() + Math.min(MAX_BACKOFF_MS, 1000 * 2 ** attempts),
            e instanceof Error ? e.message : String(e),
            item.key,
          );
        }
      }
    } finally {
      running = null;
      notifyChange();
    }
  })();
  return running;
}

function kick() {
  void flush().catch(() => undefined);
}

export interface SyncStatus {
  pending: number;
  lastError: string | null;
}

export async function syncStatus(): Promise<SyncStatus> {
  const db = await localDb();
  const row = await db.getFirstAsync<{ n: number; err: string | null }>(
    'SELECT COUNT(*) AS n, MAX(last_error) AS err FROM sync_queue',
  );
  return { pending: row?.n ?? 0, lastError: row?.err ?? null };
}

/** Start background flushing: on an interval and whenever the app comes to the foreground. */
export function startSync(): () => void {
  kick();
  const timer = setInterval(kick, POLL_MS);
  const sub = AppState.addEventListener('change', (s) => {
    if (s === 'active') kick();
  });
  return () => {
    clearInterval(timer);
    sub.remove();
  };
}

/**
 * Pull a round from Supabase into the local store when this device has no
 * shots for it (e.g. after a reinstall). Never overwrites local data.
 */
export async function hydrateRound(roundId: string): Promise<void> {
  if ((await local.countRoundShots(roundId)) > 0) return;
  if ((await local.getHoleScores(roundId)).length > 0) return;
  const remote = await getRemoteRound(supabase, roundId);
  if (!remote) return;
  if (!(await local.getRound(roundId))) await local.putRound(remote.round);
  const shots = await listShots(supabase, roundId);
  const holes = new Set([
    ...shots.map((s) => s.holeNumber),
    ...remote.holeScores.map((h) => h.holeNumber),
  ]);
  for (const hole of holes) {
    const score = remote.holeScores.find((h) => h.holeNumber === hole) ?? {
      roundId,
      holeNumber: hole,
      strokesLogged: 0,
      strokesOverride: null,
      overrideReason: null,
      putts: 0,
      penalties: 0,
      points: null,
      netStrokes: null,
    };
    await local.replaceHole(
      roundId,
      hole,
      shots.filter((s) => s.holeNumber === hole),
      score,
      { tombstones: false },
    );
  }
}
