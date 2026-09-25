/** React hooks over the local store (re-run on every local change) and cached remote data. */
import {
  getCourseBundle,
  getProfile,
  listClubConditionPatterns,
  listClubPatterns,
  listClubs,
  listRounds as listRemoteRounds,
  type Club,
  type CourseBundle,
  type HoleScore,
  type Profile,
  type Round,
  type Shot,
  type StoredClubPattern,
  type StoredConditionPattern,
} from '@caddymate/api';
import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { subscribe } from './events';
import * as local from './local';
import { CONDITION_PATTERNS_KEY, PATTERNS_KEY, syncStatus, type SyncStatus } from './sync';

export interface QueryState<T> {
  data: T | undefined;
  error: Error | null;
  loading: boolean;
  reload: () => void;
}

/** Run an async query now and again after every local write. */
export function useLocalQuery<T>(query: () => Promise<T>, deps: readonly unknown[]): QueryState<T> {
  const [state, setState] = useState<{
    data: T | undefined;
    error: Error | null;
    loading: boolean;
  }>({ data: undefined, error: null, loading: true });
  const queryRef = useRef(query);
  queryRef.current = query;
  const seq = useRef(0);

  const run = useCallback(() => {
    const mine = ++seq.current;
    queryRef
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

  useEffect(() => {
    run();
    return subscribe(run);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { ...state, reload: run };
}

export const useLocalRounds = () => useLocalQuery(() => local.listRounds(), []);
export const useRound = (id: string) => useLocalQuery<Round | null>(() => local.getRound(id), [id]);
export const useRoundShots = (id: string) =>
  useLocalQuery<Shot[]>(() => local.getRoundShots(id), [id]);
export const useHoleScores = (id: string) =>
  useLocalQuery<HoleScore[]>(() => local.getHoleScores(id), [id]);
export const useSyncStatus = () => useLocalQuery<SyncStatus>(() => syncStatus(), []);

/**
 * Cache-then-network: resolve from the local kv cache immediately, refresh
 * from Supabase in the background and write the result back to the cache.
 */
function useCached<T>(
  key: string | null,
  fetchRemote: () => Promise<T>,
): QueryState<T> & { refreshing: boolean } {
  const [refreshing, setRefreshing] = useState(false);
  const [remoteError, setRemoteError] = useState<Error | null>(null);
  const cached = useLocalQuery<T | null>(
    () => (key ? local.kvGet<T>(key) : Promise.resolve(null)),
    [key],
  );
  const fetchRef = useRef(fetchRemote);
  fetchRef.current = fetchRemote;

  const refresh = useCallback(() => {
    if (!key) return;
    setRefreshing(true);
    fetchRef
      .current()
      .then((v) => local.kvSet(key, v))
      .then(() => setRemoteError(null))
      .catch((e: unknown) => setRemoteError(e instanceof Error ? e : new Error(String(e))))
      .finally(() => setRefreshing(false));
  }, [key]);

  useEffect(refresh, [refresh]);

  return {
    data: cached.data ?? undefined,
    // A remote failure only matters when there is nothing cached to show.
    error: cached.data ? null : (remoteError ?? cached.error),
    loading: cached.loading || (cached.data == null && refreshing),
    reload: refresh,
    refreshing,
  };
}

export const useClubs = () => useCached<Club[]>('clubs', () => listClubs(supabase));

/** Stored club patterns (§8.4); refreshed after refits (see sync.ts). */
export const useClubPatterns = () =>
  useCached<StoredClubPattern[]>(PATTERNS_KEY, () => listClubPatterns(supabase));

/** Stored empirical condition-bucket patterns (§8.5). */
export const useConditionPatterns = () =>
  useCached<StoredConditionPattern[]>(CONDITION_PATTERNS_KEY, () =>
    listClubConditionPatterns(supabase),
  );

export const useCourseBundle = (courseId: string | undefined, version: number | undefined) =>
  useCached<CourseBundle>(
    courseId ? `course:${courseId}:${String(version ?? 'current')}` : null,
    () => getCourseBundle(supabase, courseId ?? '', version),
  );

export const useProfile = (userId: string | undefined) =>
  useCached<Profile | null>(userId ? `profile:${userId}` : null, () =>
    getProfile(supabase, userId ?? ''),
  );

/** Remote rounds not yet on this device get copied into the local list (never overwriting). */
export function useRemoteRoundsMerge(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;
    void (async () => {
      try {
        const remote = await listRemoteRounds(supabase, { limit: 20 });
        for (const r of remote) {
          if (!(await local.getRound(r.id))) {
            const round: Round = { ...r };
            delete (round as Partial<typeof r>).courseName;
            await local.putRound(round);
          }
        }
      } catch {
        // Offline: the local list is still correct for this device.
      }
    })();
  }, [enabled]);
}
