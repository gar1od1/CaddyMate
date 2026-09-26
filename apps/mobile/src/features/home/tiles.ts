/**
 * Which home-screen tiles to show (docs/standards/permissions.md §5 gate 2:
 * page access equals nav access). A tile is shown only when `canOpenPath`
 * lets the role open the route it links to, so a denied page never looks
 * reachable. Pure — the screen reads the grants from `@/lib/grants`.
 */
import { canOpenPath, type Grants } from '@caddymate/api';

export interface HomeTiles {
  /** Start / resume a round (`/round/*`, page `rounds`). */
  play: boolean;
  /** My bag (`/bag`, page `clubs`). */
  bag: boolean;
  /** Trends (`/review/trends`, page `rounds.trends`). */
  trends: boolean;
  /** The per-round Review pill (`/review/<id>`, page `rounds.review`). */
  review: boolean;
}

export function homeTiles(grants: Grants | null): HomeTiles {
  const open = (path: string) => canOpenPath(path, 'mobile', grants);
  return {
    play: open('/round/new'),
    bag: open('/bag'),
    trends: open('/review/trends'),
    review: open('/review/round'),
  };
}

/** Whether the bag can link a club to its dispersion page (`/review/clubs/<id>`, page `clubs`). */
export const canOpenClubDispersion = (grants: Grants | null, clubId: string) =>
  canOpenPath(`/review/clubs/${clubId}`, 'mobile', grants);
