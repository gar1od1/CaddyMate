/**
 * `POST /import-sim { source, csv, clubAliases?, utcOffsetMinutes? }` —
 * simulator import (docs/SPEC.md §12). Parses a GSPro / Square Golf export,
 * dedupes by file hash (`sim_sessions.file_hash`) and by (club, carry,
 * timestamp ±1 s) against earlier imports and within the file, inserts a
 * `sim_sessions` row plus one `shots` row per shot (`source = 'sim'`, SI
 * metres, `strike = 'good'`), remembers new club aliases, and refits the
 * affected clubs.
 */
import { HttpError, json } from '../_shared/http.ts';
import { type Grants, requirePermission } from '../_shared/permissions.ts';
import { refitClubs, type ClubRefitResult } from '../_shared/refit.ts';
import { parseSimCsv, SimCsvError, type SimFormat, type SimShot } from '../_shared/simcsv.ts';
import { isUuid, readJson, type SimShotInsert, type SimStore } from '../_shared/store.ts';
import { type ClubRow, num } from '../_shared/types.ts';

export const MAX_CSV_BYTES = 5_000_000;
export const MAX_ROWS = 20_000;
/** Timestamp tolerance for (club, carry, timestamp) dedupe. */
export const DEDUPE_WINDOW_MS = 1000;

export interface ImportSimDeps {
  authenticate(req: Request): Promise<{ userId: string; store: SimStore; grants: Grants }>;
  now(): Date;
}

export interface ImportSimResponse {
  sessionId: string;
  /** True when this exact file was imported before (nothing inserted). */
  duplicate: boolean;
  format: SimFormat;
  detected: SimFormat | null;
  inserted: number;
  /** Rows not inserted: duplicates, unmapped clubs and unparseable rows. */
  skipped: number;
  skippedDetail: { duplicates: number; unmappedClub: number; invalid: number };
  /** Club names in the file with no mapping (pass them in `clubAliases`). */
  unmappedClubs: string[];
  clubsRefit: ClubRefitResult[];
}

/** SHA-256 hex of the file with line endings normalised (a re-saved CRLF copy is the same file). */
export async function fileHash(csv: string): Promise<string> {
  const bytes = new TextEncoder().encode(csv.replace(/\r\n?/g, '\n').trim());
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

/**
 * Club resolver: `clubAliases` from the request (name → club id; must be the
 * caller's club), then each club's stored `sim_name_aliases`, then its name.
 * Matching ignores case and repeated spaces.
 */
export function clubResolver(
  clubs: readonly ClubRow[],
  aliases: Record<string, string>,
): (name: string) => string | null {
  const ids = new Set(clubs.map((c) => c.club_id));
  const m = new Map<string, string>();
  for (const c of clubs) m.set(norm(c.name), c.club_id);
  for (const c of clubs) for (const a of c.sim_name_aliases ?? []) m.set(norm(a), c.club_id);
  for (const [name, id] of Object.entries(aliases)) {
    if (!ids.has(id))
      throw new HttpError(400, 'bad_request', `clubAliases["${name}"] is not one of your clubs`);
    m.set(norm(name), id);
  }
  return (name) => m.get(norm(name)) ?? null;
}

function parseBody(body: Record<string, unknown>) {
  const source = body.source;
  if (source !== 'gspro' && source !== 'square') {
    throw new HttpError(400, 'bad_request', "source must be 'gspro' or 'square'");
  }
  const csv = body.csv;
  if (typeof csv !== 'string' || csv.trim() === '') {
    throw new HttpError(400, 'bad_request', 'csv must be a non-empty string');
  }
  if (new TextEncoder().encode(csv).length > MAX_CSV_BYTES) {
    throw new HttpError(413, 'too_large', `csv exceeds ${MAX_CSV_BYTES} bytes`);
  }
  const rawAliases = body.clubAliases ?? {};
  if (typeof rawAliases !== 'object' || rawAliases === null || Array.isArray(rawAliases)) {
    throw new HttpError(400, 'bad_request', 'clubAliases must be an object of name → club id');
  }
  const clubAliases: Record<string, string> = {};
  for (const [k, v] of Object.entries(rawAliases)) {
    if (!isUuid(v)) throw new HttpError(400, 'bad_request', `clubAliases["${k}"] must be a uuid`);
    clubAliases[k] = v;
  }
  const off = body.utcOffsetMinutes;
  if (
    off !== undefined &&
    (typeof off !== 'number' || !Number.isInteger(off) || Math.abs(off) > 14 * 60)
  ) {
    throw new HttpError(400, 'bad_request', 'utcOffsetMinutes must be an integer in [-840, 840]');
  }
  return { source: source as SimFormat, csv, clubAliases, utcOffsetMinutes: (off as number) ?? 0 };
}

interface Candidate {
  shot: SimShot;
  clubId: string;
  at: number | null;
}

const sameCarry = (a: number, b: number) => Math.abs(a - b) < 0.006;

/** Drop candidates matching an existing shot or an earlier candidate (club, carry, |Δt| ≤ 1 s). */
export function dedupe(
  candidates: readonly Candidate[],
  existing: readonly { clubId: string; at: number; carryM: number }[],
): { keep: Candidate[]; duplicates: number } {
  const seen = new Map<string, { at: number; carryM: number }[]>();
  const add = (clubId: string, at: number, carryM: number) => {
    const l = seen.get(clubId) ?? [];
    l.push({ at, carryM });
    seen.set(clubId, l);
  };
  for (const e of existing) add(e.clubId, e.at, e.carryM);
  const keep: Candidate[] = [];
  let duplicates = 0;
  for (const c of candidates) {
    // Without a timestamp only the file hash can dedupe.
    if (c.at !== null) {
      const hit = (seen.get(c.clubId) ?? []).some(
        (e) => Math.abs(e.at - c.at!) <= DEDUPE_WINDOW_MS && sameCarry(e.carryM, c.shot.carryM),
      );
      if (hit) {
        duplicates++;
        continue;
      }
      add(c.clubId, c.at, c.shot.carryM);
    }
    keep.push(c);
  }
  return { keep, duplicates };
}

export async function handleImportSim(req: Request, deps: ImportSimDeps): Promise<Response> {
  if (req.method !== 'POST') throw new HttpError(405, 'method_not_allowed', 'Use POST');
  const { userId, store, grants } = await deps.authenticate(req);
  requirePermission(grants, 'import.write');
  const { source, csv, clubAliases, utcOffsetMinutes } = parseBody(await readJson(req));

  let parsed;
  try {
    parsed = parseSimCsv(csv, { utcOffsetMinutes });
  } catch (err) {
    if (err instanceof SimCsvError) throw new HttpError(422, 'unparseable', err.message);
    throw err;
  }
  if (parsed.shots.length > MAX_ROWS) {
    throw new HttpError(413, 'too_large', `more than ${MAX_ROWS} shots in one file`);
  }
  const base = { format: source, detected: parsed.detected };

  const hash = await fileHash(csv);
  const duplicateResponse = (sessionId: string): ImportSimResponse => ({
    sessionId,
    duplicate: true,
    ...base,
    inserted: 0,
    skipped: parsed.shots.length + parsed.rejected.length,
    skippedDetail: {
      duplicates: parsed.shots.length,
      unmappedClub: 0,
      invalid: parsed.rejected.length,
    },
    unmappedClubs: [],
    clubsRefit: [],
  });
  const previous = await store.sessionByHash(hash);
  if (previous) return json(duplicateResponse(previous));

  const clubs = await store.clubs();
  const resolve = clubResolver(clubs, clubAliases);
  const unmapped = new Set<string>();
  const candidates: Candidate[] = [];
  for (const shot of parsed.shots) {
    const clubId = resolve(shot.club);
    if (!clubId) {
      unmapped.add(shot.club);
      continue;
    }
    candidates.push({ shot, clubId, at: shot.playedAt ? Date.parse(shot.playedAt) : null });
  }
  const unmappedCount = parsed.shots.length - candidates.length;

  const times = candidates.flatMap((c) => (c.at === null ? [] : [c.at]));
  const existing = times.length
    ? (
        await store.simShotsBetween(
          [...new Set(candidates.map((c) => c.clubId))],
          new Date(times.reduce((a, b) => Math.min(a, b)) - DEDUPE_WINDOW_MS).toISOString(),
          new Date(times.reduce((a, b) => Math.max(a, b)) + DEDUPE_WINDOW_MS).toISOString(),
        )
      ).flatMap((e) => {
        const carryM = num(e.sim_carry_m);
        const at = Date.parse(e.played_at);
        return carryM === null || Number.isNaN(at) ? [] : [{ clubId: e.club_id, at, carryM }];
      })
    : [];
  const { keep, duplicates } = dedupe(candidates, existing);

  const sessionId = await store.insertSession({
    user_id: userId,
    source,
    file_hash: hash,
    row_count: keep.length,
    raw_payload: {
      detected: parsed.detected,
      headers: parsed.headers,
      units: parsed.units,
      rows: parsed.shots.map((s) => s.raw),
      rejected: parsed.rejected,
    },
  });
  // Lost a race with a concurrent import of the same file.
  if (sessionId === null) {
    const winner = await store.sessionByHash(hash);
    if (!winner) throw new HttpError(409, 'conflict', 'Concurrent import of the same file');
    return json(duplicateResponse(winner));
  }

  // Shots without a timestamp are spread 1 s apart from the import time, in file order.
  const nowMs = deps.now().getTime();
  const rows: SimShotInsert[] = keep.map((c, i) => ({
    user_id: userId,
    source: 'sim',
    club_id: c.clubId,
    played_at: c.shot.playedAt ?? new Date(nowMs - (keep.length - i) * 1000).toISOString(),
    sim_session_id: sessionId,
    sim_carry_m: c.shot.carryM,
    sim_total_m: c.shot.totalM,
    sim_offline_m: c.shot.offlineM,
    strike: 'good',
  }));
  try {
    await store.insertShots(rows);
  } catch (err) {
    // Leave no half-imported session behind (shots cascade), so a retry is not "duplicate".
    await store.deleteSession(sessionId).catch((e: unknown) => console.error('rollback failed', e));
    throw err;
  }

  // Remember names the player mapped this time (§12: later imports do not ask again).
  for (const club of clubs) {
    const stored = club.sim_name_aliases ?? [];
    const known = new Set([norm(club.name), ...stored.map(norm)]);
    const added = Object.entries(clubAliases)
      .filter(([name, id]) => id === club.club_id && !known.has(norm(name)))
      .map(([name]) => name.trim());
    if (added.length) await store.setClubAliases(club.club_id, [...stored, ...new Set(added)]);
  }

  const clubIds = [...new Set(keep.map((c) => c.clubId))];
  const refit = clubIds.length
    ? await refitClubs(store, userId, { clubIds, now: deps.now() })
    : null;

  return json({
    sessionId,
    duplicate: false,
    ...base,
    inserted: rows.length,
    skipped: duplicates + unmappedCount + parsed.rejected.length,
    skippedDetail: { duplicates, unmappedClub: unmappedCount, invalid: parsed.rejected.length },
    unmappedClubs: [...unmapped].sort(),
    clubsRefit: refit?.clubs ?? [],
  } satisfies ImportSimResponse);
}
