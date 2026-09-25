/**
 * One-line "why" for a recommendation (docs/SPEC.md §9.4, §17 Q1), e.g.
 * "7i — aim 9 yds left of pin. 61 % green, 9 % bunker, 0.19 strokes better
 * than at the pin." Distances are converted at this edge only.
 */
import { metresToYards } from '../units/index.js';
import type { FeatureKind } from '../types/index.js';
import type { StrategyOption } from './search.js';

export type DistanceUnits = 'yards' | 'metres';

/** Differences smaller than this read as "same as". */
const LEVEL_EPS = 0.005;

const HAZARD_NAMES: Partial<Record<FeatureKind, string>> = {
  bunker: 'bunker',
  water: 'water',
  tree: 'trees',
  wooded: 'trees',
};

const pct = (p: number): string => `${String(Math.round(p * 100))} %`;

/** `|m|` rounded in the display unit (0 when the offset rounds away). */
function roundedOffset(m: number, units: DistanceUnits): number {
  return Math.round(units === 'yards' ? metresToYards(Math.abs(m)) : Math.abs(m));
}

const distance = (m: number, units: DistanceUnits): string =>
  `${String(roundedOffset(m, units))} ${units === 'yards' ? 'yds' : 'm'}`;

function aimPhrase(o: StrategyOption, units: DistanceUnits): string {
  if (o.kind === 'approach') {
    if (roundedOffset(o.aimOffsetM.lateralM, units) === 0) return 'aim at the pin';
    const side = o.aimOffsetM.lateralM < 0 ? 'left' : 'right';
    return `aim ${distance(o.aimOffsetM.lateralM, units)} ${side} of pin`;
  }
  const out = distance(Math.hypot(o.aimOffsetM.alongM, o.aimOffsetM.lateralM), units);
  if (roundedOffset(o.lineOffsetM, units) === 0) return `play to ${out} out, down the line`;
  const side = o.lineOffsetM < 0 ? 'left' : 'right';
  return `play to ${out} out, ${distance(o.lineOffsetM, units)} ${side} of the line`;
}

function outcomePhrases(o: StrategyOption): string[] {
  const parts = [o.kind === 'approach' ? `${pct(o.pGreen)} green` : `${pct(o.pFairway)} fairway`];
  const hazards = (Object.entries(o.pHazardByKind) as [FeatureKind, number][])
    .filter(([, p]) => Math.round(p * 100) >= 1)
    .sort((a, b) => b[1] - a[1]);
  const top = hazards[0];
  if (top !== undefined) parts.push(`${pct(top[1])} ${HAZARD_NAMES[top[0]] ?? 'penalty area'}`);
  if (Math.round(o.pOb * 100) >= 1) parts.push(`${pct(o.pOb)} OB`);
  return parts;
}

function comparison(o: StrategyOption, base: StrategyOption): string {
  let ref: string;
  if (base.kind === 'layup') ref = `${base.clubLabel} down the line`;
  else ref = base.clubId === o.clubId ? 'at the pin' : `${base.clubLabel} at the pin`;
  const delta = base.expectedStrokes - o.expectedStrokes;
  if (Math.abs(delta) < LEVEL_EPS) return `same as ${ref}`;
  return `${Math.abs(delta).toFixed(2)} strokes ${delta > 0 ? 'better' : 'worse'} than ${ref}`;
}

/** One-line explanation of `option` against the baseline ("at the pin") option. */
export function explainOption(
  option: StrategyOption,
  baselineOption: StrategyOption,
  units: DistanceUnits = 'yards',
): string {
  const outcomes = [...outcomePhrases(option), comparison(option, baselineOption)].join(', ');
  return `${option.clubLabel} — ${aimPhrase(option, units)}. ${outcomes}.`;
}
