/** Scorecard hooks; the maths lives in ./scorecard (engine scoring, pure). */
import { holeStrokes } from '@caddymate/api';
import { useHoleScores } from '@/data/hooks';

export {
  buildScorecard,
  finishTotals,
  type CardRow,
  type CardTotals,
  type Scorecard,
} from './scorecard';

/** Lightweight totals for list rows (uses the points stored on hole scores). */
export function useHoleScoresSummary(roundId: string) {
  const scores = useHoleScores(roundId).data ?? [];
  const played = scores.filter((s) => holeStrokes(s) > 0);
  return {
    holesPlayed: played.length,
    gross: played.reduce((s, h) => s + holeStrokes(h), 0),
    points: played.reduce((s, h) => s + (h.points ?? 0), 0),
  };
}
