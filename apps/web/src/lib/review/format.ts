/** Display formatting at the UI edge: metres → yards, dates, signed strokes. */
import { metresToYards } from '@caddymate/engine';

export const yds = (m: number | null | undefined, dp = 0): string =>
  m === null || m === undefined ? '—' : metresToYards(m).toFixed(dp);

export const fmtDate = (iso: string): string =>
  new Date(iso).toLocaleDateString('en-IE', { day: 'numeric', month: 'short', year: 'numeric' });

export const fmtShortDate = (iso: string): string =>
  new Date(iso).toLocaleDateString('en-IE', { day: 'numeric', month: 'short' });

/** "+0.42" / "−1.10" / "—". */
export const sgText = (v: number | null | undefined, dp = 2): string =>
  v === null || v === undefined
    ? '—'
    : `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(dp)}`;

export const pctText = (p: number): string => `${String(Math.round(p * 100))} %`;
