/**
 * On-device SQLite store (docs/SPEC.md §16 "Sync"): shots, hole scores and
 * rounds are written here first and pushed to Supabase by the sync queue.
 * Rows keep the domain object as JSON plus the few columns we query on.
 * The database is opened lazily so importing this module never touches
 * native code (keeps `expo export` and tests import-safe).
 */
import { openDatabaseAsync, type SQLiteDatabase } from 'expo-sqlite';

const SCHEMA = `
PRAGMA journal_mode = WAL;
CREATE TABLE IF NOT EXISTS kv (
  key TEXT PRIMARY KEY NOT NULL,
  json TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS rounds (
  round_id TEXT PRIMARY KEY NOT NULL,
  started_at TEXT NOT NULL,
  json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS shots (
  shot_id TEXT PRIMARY KEY NOT NULL,
  round_id TEXT NOT NULL,
  hole_number INTEGER NOT NULL,
  seq INTEGER NOT NULL,
  json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS shots_hole_idx ON shots (round_id, hole_number, seq);
CREATE TABLE IF NOT EXISTS hole_scores (
  round_id TEXT NOT NULL,
  hole_number INTEGER NOT NULL,
  json TEXT NOT NULL,
  PRIMARY KEY (round_id, hole_number)
);
CREATE TABLE IF NOT EXISTS tombstones (
  shot_id TEXT PRIMARY KEY NOT NULL,
  round_id TEXT NOT NULL,
  hole_number INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sync_queue (
  key TEXT PRIMARY KEY NOT NULL,
  kind TEXT NOT NULL,
  round_id TEXT NOT NULL,
  hole_number INTEGER,
  version INTEGER NOT NULL DEFAULT 0,
  attempts INTEGER NOT NULL DEFAULT 0,
  next_at INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at INTEGER NOT NULL
);
`;

let opening: Promise<SQLiteDatabase> | null = null;

export function localDb(): Promise<SQLiteDatabase> {
  opening ??= openDatabaseAsync('caddymate.db').then(async (db) => {
    await db.execAsync(SCHEMA);
    return db;
  });
  return opening;
}
