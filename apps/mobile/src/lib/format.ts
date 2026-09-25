import { metresToFeet, metresToYards, mpsToMph } from '@caddymate/engine';

export const yd = (m: number | null | undefined): string =>
  m === null || m === undefined || !Number.isFinite(m) ? '–' : String(Math.round(metresToYards(m)));

export const ft = (m: number | null | undefined): string =>
  m === null || m === undefined ? '–' : String(Math.round(metresToFeet(m)));

export const mph = (mps: number): string => String(Math.round(mpsToMph(mps)));

const COMPASS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
export const compass = (deg: number): string =>
  COMPASS[Math.round((((deg % 360) + 360) % 360) / 45) % 8] ?? 'N';

export const toPar = (n: number): string => (n === 0 ? 'E' : n > 0 ? `+${String(n)}` : String(n));

export const shortDate = (iso: string): string => {
  const d = new Date(iso);
  return `${d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })} ${d
    .toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
    .replace(/:00$/, '')}`;
};
