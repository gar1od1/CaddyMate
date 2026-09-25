/**
 * Design tokens. Dark-first (satellite map + white numerals + green accent),
 * in the spirit of TheGrint. Mobile consumes these directly; web maps them to
 * CSS variables in globals.css.
 */
export const colors = {
  bg: '#0B1F14',
  bgElevated: '#12291B',
  surface: '#1A3324',
  surfaceMuted: '#22402E',
  border: '#2E5038',
  text: '#F4F7F5',
  textMuted: '#A8BDB0',
  textFaint: '#6F8A79',
  accent: '#3DDC84',
  accentPressed: '#2FBF70',
  accentText: '#062A16',
  warning: '#F5B942',
  danger: '#F06262',
  info: '#5AB7F5',
  /** Cone / ellipse fills on the map. */
  cone: 'rgba(61, 220, 132, 0.28)',
  coneCore: 'rgba(61, 220, 132, 0.55)',
  coneMiss: 'rgba(240, 98, 98, 0.30)',
  hazardWater: 'rgba(90, 183, 245, 0.35)',
  hazardBunker: 'rgba(245, 226, 170, 0.45)',
} as const;

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;

export const radius = { sm: 6, md: 10, lg: 16, pill: 999 } as const;

export const type = {
  /** Distance numerals on the play view. */
  distance: { fontSize: 44, fontWeight: '800', letterSpacing: -1 },
  title: { fontSize: 24, fontWeight: '700' },
  heading: { fontSize: 18, fontWeight: '600' },
  body: { fontSize: 16, fontWeight: '400' },
  caption: { fontSize: 13, fontWeight: '500' },
} as const;

export type Colors = typeof colors;
