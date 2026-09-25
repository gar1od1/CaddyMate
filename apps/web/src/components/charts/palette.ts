/**
 * Chart colours. Surfaces, ink and grid come from the globals.css tokens;
 * the categorical slots were checked for the dark surface (#1a3324) with the
 * dataviz validator (lightness band, chroma, CVD ΔE ≥ 8, contrast ≥ 3:1).
 * Assign in fixed order and never reuse the status colours for series.
 */
import type { SgCategory } from '@caddymate/engine';

export const INK = 'var(--color-text)';
export const MUTED = 'var(--color-muted)';
export const FAINT = 'var(--color-faint)';
export const GRID = 'var(--color-border)';
export const SURFACE = 'var(--color-surface)';

/** Fixed categorical order: blue, orange, violet, yellow. */
export const SERIES = ['#3987e5', '#d95926', '#9085e9', '#c98500'] as const;

export const CATEGORY_COLOURS: Readonly<Record<SgCategory, string>> = {
  ott: SERIES[0],
  app: SERIES[1],
  arg: SERIES[2],
  putt: SERIES[3],
};

export const CATEGORY_LABELS: Readonly<Record<SgCategory, string>> = {
  ott: 'Off the tee',
  app: 'Approach',
  arg: 'Around green',
  putt: 'Putting',
};

/** Diverging poles for signed values (strokes gained / lost). */
export const POSITIVE = '#3987e5';
export const NEGATIVE = '#e66767';
