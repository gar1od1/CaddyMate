/**
 * Runs the strategy search (docs/SPEC.md §9.3) off the render path: after
 * pending interactions (map gestures, sheet animations) settle, in a
 * separate macrotask, cached per position key so revisiting a position or a
 * re-render never searches twice. The card's (club, aim) is re-scored with
 * `evaluateChoice` after a short debounce so taps on the map stay snappy.
 */
import {
  recommend,
  type LatLng,
  type Recommendation,
  type RecommendInput,
  type StrategyOption,
} from '@caddymate/engine';
import { useEffect, useRef, useState } from 'react';
import { InteractionManager } from 'react-native';
import { evaluateCardChoice, RecommendationCache } from './recommendation';

const cache = new RecommendationCache();

/** Recommendation for `key`, computing it synchronously if needed (used at Hit). */
export function recommendNow(input: RecommendInput, key: string): Recommendation | null {
  const hit = cache.get(key);
  if (hit) return hit;
  try {
    const rec = recommend(input);
    cache.set(key, rec);
    return rec;
  } catch {
    return null;
  }
}

export function useRecommendation(
  input: RecommendInput | null,
  key: string | null,
): { rec: Recommendation | null; computing: boolean } {
  const [state, setState] = useState<{ key: string | null; rec: Recommendation | null }>({
    key: null,
    rec: null,
  });
  const [computing, setComputing] = useState(false);
  const inputRef = useRef(input);
  inputRef.current = input;

  useEffect(() => {
    if (!key || !inputRef.current) {
      setState({ key: null, rec: null });
      setComputing(false);
      return;
    }
    const cached = cache.get(key);
    if (cached) {
      setState({ key, rec: cached });
      setComputing(false);
      return;
    }
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    setComputing(true);
    const task = InteractionManager.runAfterInteractions(() => {
      timer = setTimeout(() => {
        const current = inputRef.current;
        const rec = current ? recommendNow(current, key) : null;
        if (alive) {
          setState({ key, rec });
          setComputing(false);
        }
      }, 0);
    });
    return () => {
      alive = false;
      task.cancel();
      if (timer) clearTimeout(timer);
    };
  }, [key]);

  // Never show a recommendation computed for a different position.
  return { rec: state.key === key ? state.rec : null, computing };
}

const CHOICE_DEBOUNCE_MS = 150;

/** The card's (club, aim) scored like the recommendation; null until both exist. */
export function useChoiceEvaluation(
  input: RecommendInput | null,
  key: string | null,
  rec: Recommendation | null,
  clubId: string | null,
  aim: LatLng | null,
): StrategyOption | null {
  const [choice, setChoice] = useState<{ sig: string; option: StrategyOption | null } | null>(null);
  const inputRef = useRef(input);
  inputRef.current = input;
  const sig =
    key && rec && clubId && aim
      ? `${key}#${clubId}@${aim.lat.toFixed(6)},${aim.lng.toFixed(6)}`
      : null;

  useEffect(() => {
    if (!sig || !rec || !clubId || !aim) return;
    const t = setTimeout(() => {
      const current = inputRef.current;
      let option: StrategyOption | null = null;
      try {
        option = current ? evaluateCardChoice(current, rec, clubId, aim) : null;
      } catch {
        option = null;
      }
      setChoice({ sig, option });
    }, CHOICE_DEBOUNCE_MS);
    return () => clearTimeout(t);
    // `sig` captures clubId/aim/key; rec identity changes with key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig, rec]);

  return choice && choice.sig === sig ? choice.option : null;
}
