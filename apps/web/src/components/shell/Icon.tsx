import type { IconName } from './icon-names';

export type { IconName } from './icon-names';

/**
 * The web icon set: monochrome single-weight (1.75) line glyphs on a 24×24
 * grid, stroked in `currentColor`. Reference by name; never use emoji. A
 * missing icon is added here, in the same style, not drawn inline elsewhere.
 */
const PATHS: Record<IconName, React.ReactNode> = {
  // Flag on a green: the CaddyMate mark.
  brand: (
    <>
      <path d="M8 20V4l9 3.5L8 11" />
      <ellipse cx="12" cy="20" rx="8" ry="2" />
    </>
  ),
  rounds: (
    <>
      <path d="M6 21V3l11 4.5L6 12" />
      <path d="M3 21h14" />
    </>
  ),
  review: (
    <>
      <rect x="4" y="3" width="16" height="18" rx="2" />
      <path d="M8 8h8M8 12h8M8 16h5" />
    </>
  ),
  trends: (
    <>
      <path d="M3 3v18h18" />
      <path d="M7 15l4-4 3 3 6-7" />
    </>
  ),
  clubs: (
    <>
      <path d="M15 3L8.5 18" />
      <path d="M8.5 18c-.6 1.6-2.3 2.6-4.5 2.3l.4-2.2c.9-.1 2-.1 4.1-.1z" />
    </>
  ),
  courses: (
    <>
      <path d="M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2z" />
      <path d="M9 4v14M15 6v14" />
    </>
  ),
  import: (
    <>
      <path d="M12 3v12M7 10l5 5 5-5" />
      <path d="M4 17v3h16v-3" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1" />
    </>
  ),
  menu: <path d="M4 6h16M4 12h16M4 18h16" />,
  close: <path d="M6 6l12 12M18 6L6 18" />,
  'chevron-down': <path d="M6 9l6 6 6-6" />,
  'chevron-left': <path d="M15 6l-6 6 6 6" />,
  'chevron-right': <path d="M9 6l6 6-6 6" />,
  filter: <path d="M3 5h18l-7 8v6l-4-2v-4z" />,
  'sort-asc': <path d="M12 19V5M6 11l6-6 6 6" />,
  'sort-desc': <path d="M12 5v14M6 13l6 6 6-6" />,
  search: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="M16 16l5 5" />
    </>
  ),
  check: <path d="M5 12.5l4.5 4.5L19 7" />,
  user: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21c1.2-4 4.3-6 8-6s6.8 2 8 6" />
    </>
  ),
  'sign-out': (
    <>
      <path d="M14 4h5v16h-5" />
      <path d="M10 8l-4 4 4 4M6 12h10" />
    </>
  ),
  monitor: (
    <>
      <rect x="3" y="4" width="18" height="12" rx="1.5" />
      <path d="M9 20h6M12 16v4" />
    </>
  ),
};

export function Icon({
  name,
  size = 20,
  filled = false,
  className,
}: {
  name: IconName;
  size?: number;
  /** Fill the shape too (the active filter funnel). */
  filled?: boolean;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      {PATHS[name]}
    </svg>
  );
}
