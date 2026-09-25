/** Typed read/write helpers over the SQLite store. All writes notify hooks. */
import type { HoleScore, Round, Shot } from '@caddymate/api';
import { localDb } from './db';
import { notifyChange } from './events';

const parse = <T>(rows: { json: string }[]): T[] => rows.map((r) => JSON.parse(r.json) as T);

// --- key/value cache (course bundles, clubs, profile, weather) --------------

export async function kvGet<T>(key: string): Promise<T | null> {
  const db = await localDb();
  const row = await db.getFirstAsync<{ json: string }>('SELECT json FROM kv WHERE key = ?', key);
  return row ? (JSON.parse(row.json) as T) : null;
}

export async function kvSet(key: string, value: unknown): Promise<void> {
  const db = await localDb();
  await db.runAsync(
    'INSERT OR REPLACE INTO kv (key, json, updated_at) VALUES (?, ?, ?)',
    key,
    JSON.stringify(value),
    Date.now(),
  );
  notifyChange();
}

// --- binary cache (elevation rasters) -------------------------------------

export async function blobGet(key: string): Promise<Uint8Array | null> {
  const db = await localDb();
  const row = await db.getFirstAsync<{ data: Uint8Array }>(
    'SELECT data FROM blobs WHERE key = ?',
    key,
  );
  return row ? row.data : null;
}

/** Binary values don't notify hooks: callers keep their own decoded copy. */
export async function blobSet(key: string, data: Uint8Array): Promise<void> {
  const db = await localDb();
  await db.runAsync(
    'INSERT OR REPLACE INTO blobs (key, data, updated_at) VALUES (?, ?, ?)',
    key,
    data,
    Date.now(),
  );
}

// --- rounds ----------------------------------------------------------------

export async function getRound(id: string): Promise<Round | null> {
  const db = await localDb();
  const row = await db.getFirstAsync<{ json: string }>(
    'SELECT json FROM rounds WHERE round_id = ?',
    id,
  );
  return row ? (JSON.parse(row.json) as Round) : null;
}

export async function listRounds(limit = 30): Promise<Round[]> {
  const db = await localDb();
  return parse<Round>(
    await db.getAllAsync<{ json: string }>(
      'SELECT json FROM rounds ORDER BY started_at DESC LIMIT ?',
      limit,
    ),
  );
}

export async function putRound(round: Round, opts: { silent?: boolean } = {}): Promise<void> {
  const db = await localDb();
  await db.runAsync(
    'INSERT OR REPLACE INTO rounds (round_id, started_at, json) VALUES (?, ?, ?)',
    round.id,
    round.startedAt,
    JSON.stringify(round),
  );
  if (!opts.silent) notifyChange();
}

// --- shots -----------------------------------------------------------------

export async function getHoleShots(roundId: string, hole: number): Promise<Shot[]> {
  const db = await localDb();
  return parse<Shot>(
    await db.getAllAsync<{ json: string }>(
      'SELECT json FROM shots WHERE round_id = ? AND hole_number = ? ORDER BY seq',
      roundId,
      hole,
    ),
  );
}

export async function getRoundShots(roundId: string): Promise<Shot[]> {
  const db = await localDb();
  return parse<Shot>(
    await db.getAllAsync<{ json: string }>(
      'SELECT json FROM shots WHERE round_id = ? ORDER BY hole_number, seq',
      roundId,
    ),
  );
}

export async function countRoundShots(roundId: string): Promise<number> {
  const db = await localDb();
  const row = await db.getFirstAsync<{ n: number }>(
    'SELECT COUNT(*) AS n FROM shots WHERE round_id = ?',
    roundId,
  );
  return row?.n ?? 0;
}

/**
 * Replace one hole's shots atomically. Shots that disappeared get a
 * tombstone so the sync queue can delete them remotely.
 */
export async function replaceHole(
  roundId: string,
  hole: number,
  shots: readonly Shot[],
  score: HoleScore,
  opts: { tombstones?: boolean } = {},
): Promise<void> {
  const db = await localDb();
  await db.withTransactionAsync(async () => {
    const keep = new Set(shots.map((s) => s.id));
    const existing = await db.getAllAsync<{ shot_id: string }>(
      'SELECT shot_id FROM shots WHERE round_id = ? AND hole_number = ?',
      roundId,
      hole,
    );
    for (const { shot_id } of existing) {
      if (keep.has(shot_id)) continue;
      await db.runAsync('DELETE FROM shots WHERE shot_id = ?', shot_id);
      if (opts.tombstones !== false) {
        await db.runAsync(
          'INSERT OR REPLACE INTO tombstones (shot_id, round_id, hole_number) VALUES (?, ?, ?)',
          shot_id,
          roundId,
          hole,
        );
      }
    }
    for (const s of shots) {
      await db.runAsync(
        'INSERT OR REPLACE INTO shots (shot_id, round_id, hole_number, seq, json) VALUES (?, ?, ?, ?, ?)',
        s.id,
        roundId,
        hole,
        s.seq,
        JSON.stringify(s),
      );
    }
    await db.runAsync(
      'INSERT OR REPLACE INTO hole_scores (round_id, hole_number, json) VALUES (?, ?, ?)',
      roundId,
      hole,
      JSON.stringify(score),
    );
  });
  notifyChange();
}

export async function getTombstones(roundId: string, hole: number): Promise<string[]> {
  const db = await localDb();
  const rows = await db.getAllAsync<{ shot_id: string }>(
    'SELECT shot_id FROM tombstones WHERE round_id = ? AND hole_number = ?',
    roundId,
    hole,
  );
  return rows.map((r) => r.shot_id);
}

export async function clearTombstones(ids: readonly string[]): Promise<void> {
  if (!ids.length) return;
  const db = await localDb();
  for (const id of ids) await db.runAsync('DELETE FROM tombstones WHERE shot_id = ?', id);
}

// --- hole scores -----------------------------------------------------------

export async function getHoleScores(roundId: string): Promise<HoleScore[]> {
  const db = await localDb();
  return parse<HoleScore>(
    await db.getAllAsync<{ json: string }>(
      'SELECT json FROM hole_scores WHERE round_id = ? ORDER BY hole_number',
      roundId,
    ),
  );
}

export async function getHoleScore(roundId: string, hole: number): Promise<HoleScore | null> {
  const db = await localDb();
  const row = await db.getFirstAsync<{ json: string }>(
    'SELECT json FROM hole_scores WHERE round_id = ? AND hole_number = ?',
    roundId,
    hole,
  );
  return row ? (JSON.parse(row.json) as HoleScore) : null;
}

export async function putHoleScore(score: HoleScore): Promise<void> {
  const db = await localDb();
  await db.runAsync(
    'INSERT OR REPLACE INTO hole_scores (round_id, hole_number, json) VALUES (?, ?, ?)',
    score.roundId,
    score.holeNumber,
    JSON.stringify(score),
  );
  notifyChange();
}
