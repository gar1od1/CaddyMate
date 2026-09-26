/** Names in the `Icon` set. Nav nodes reference icons by name, never by glyph. */
export const ICON_NAMES = [
  'brand',
  'rounds',
  'review',
  'trends',
  'clubs',
  'courses',
  'import',
  'settings',
  'menu',
  'close',
  'chevron-down',
  'chevron-left',
  'chevron-right',
  'filter',
  'sort-asc',
  'sort-desc',
  'search',
  'check',
  'user',
  'sign-out',
  'monitor',
] as const;

export type IconName = (typeof ICON_NAMES)[number];
