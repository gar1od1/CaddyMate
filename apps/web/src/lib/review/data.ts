/**
 * Server-side loaders for the review and clubs pages. Read-only: they use the
 * shared `@caddymate/api` readers where they exist and plain selects
 * otherwise; RLS scopes every query to the signed-in player.
 */
import {
  getCourseBundle,
  getRound,
  listClubs,
  listClubPatterns,
  type Club,
  type CourseBundle,
  type Db,
  type HoleScore,
  type Round,
  type Row,
  type StoredClubPattern,
} from '@caddymate/api';
import type { ClubPattern } from '@caddymate/engine';
import { reviewShotFromRow, type ReviewShot } from './shots';

export interface RoundReviewData {
  round: Round;
  holeScores: HoleScore[];
  course: CourseBundle | null;
  shots: ReviewShot[];
  clubs: Club[];
  /** clubId → stored neutral pattern (serialisable pairs for client components). */
  patterns: [string, ClubPattern][];
}

export async function loadRoundReview(db: Db, roundId: string): Promise<RoundReviewData | null> {
  const got = await getRound(db, roundId);
  if (!got) return null;
  const [course, shotRows, clubs, patterns] = await Promise.all([
    getCourseBundle(db, got.round.courseId, got.round.courseVersion).catch(() => null),
    db
      .from('shots')
      .select('*')
      .eq('round_id', roundId)
      .order('hole_number')
      .order('seq')
      .then((r) => {
        if (r.error) throw new Error(`shots: ${r.error.message}`);
        return r.data;
      }),
    listClubs(db),
    listClubPatterns(db),
  ]);
  return {
    ...got,
    course,
    shots: shotRows.map((r) => reviewShotFromRow(r)),
    clubs,
    patterns: patterns.map((p: StoredClubPattern) => [p.clubId, p.params]),
  };
}

/** Round rows joined to the course name, newest first. */
export type RoundRow = Row<'rounds'> & { courses: { name: string } | null };

export async function listRoundRows(db: Db, limit = 200): Promise<RoundRow[]> {
  const { data, error } = await db
    .from('rounds')
    .select('*, courses(name)')
    .order('started_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(`rounds: ${error.message}`);
  return data as RoundRow[];
}

/** Supabase `in` filters get long; chunk the ids. */
export async function selectInChunks<T>(
  ids: readonly string[],
  run: (chunk: string[]) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  size = 100,
): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += size) {
    const { data, error } = await run(ids.slice(i, i + size));
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
  }
  return out;
}
