/**
 * Review data hooks: the round review from the local store (works offline),
 * remote queries for trends / ledger / dispersion history, and the grading
 * write-back once a finished round has synced.
 */
import { gradeRound, type RoundReview, type StoredClubPattern } from '@caddymate/api';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  useClubPatterns,
  useClubs,
  useCourseBundle,
  useHoleScores,
  useProfile,
  useRound,
  useRoundShots,
} from '@/data/hooks';
import { flush, hydrateRound, syncStatus } from '@/data/sync';
import { supabase } from '@/lib/supabase';
import { localRoundReview } from './review';

export interface RemoteState<T> {
  data: T | undefined;
  error: Error | null;
  loading: boolean;
  reload: () => void;
}

/** Run a remote query on mount / when `deps` change. */
export function useRemote<T>(query: () => Promise<T>, deps: readonly unknown[]): RemoteState<T> {
  const [state, setState] = useState<{
    data: T | undefined;
    error: Error | null;
    loading: boolean;
  }>({ data: undefined, error: null, loading: true });
  const ref = useRef(query);
  ref.current = query;
  const seq = useRef(0);
  const run = useCallback(() => {
    const mine = ++seq.current;
    setState((s) => ({ ...s, loading: true }));
    ref
      .current()
      .then((data) => {
        if (mine === seq.current) setState({ data, error: null, loading: false });
      })
      .catch((e: unknown) => {
        if (mine === seq.current)
          setState((s) => ({
            data: s.data,
            error: e instanceof Error ? e : new Error(String(e)),
            loading: false,
          }));
      });
  }, []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(run, deps);
  return { ...state, reload: run };
}

export interface RoundReviewState {
  review: RoundReview | null;
  patterns: readonly StoredClubPattern[];
  loading: boolean;
}

/** The round review computed from local data (hydrated from Supabase when missing). */
export function useRoundReview(roundId: string): RoundReviewState {
  useEffect(() => {
    void hydrateRound(roundId).catch(() => undefined);
  }, [roundId]);
  const round = useRound(roundId);
  const bundle = useCourseBundle(round.data?.courseId, round.data?.courseVersion);
  const scores = useHoleScores(roundId);
  const shots = useRoundShots(roundId);
  const clubs = useClubs();
  const patterns = useClubPatterns();
  const profile = useProfile(round.data?.userId);

  const review = useMemo(() => {
    if (!round.data || !bundle.data || !shots.data) return null;
    return localRoundReview({
      round: round.data,
      bundle: bundle.data,
      scores: scores.data ?? [],
      shots: shots.data,
      clubs: clubs.data ?? [],
      patterns: patterns.data ?? [],
      officialIndex: profile.data?.handicapIndexOfficial ?? null,
    });
  }, [round.data, bundle.data, scores.data, shots.data, clubs.data, patterns.data, profile.data]);

  return {
    review,
    patterns: patterns.data ?? [],
    loading: round.loading || bundle.loading || shots.loading,
  };
}

/**
 * Write the SG and grade columns for a finished round (§9.5) once its shots
 * are on the server: flush the sync queue, and grade only when nothing is
 * pending. Best effort — the review screens compute the same numbers locally,
 * and opening the review retries.
 */
export async function gradeRoundWhenSynced(roundId: string): Promise<boolean> {
  await flush();
  if ((await syncStatus()).pending > 0) return false;
  await gradeRound(supabase, roundId);
  return true;
}
