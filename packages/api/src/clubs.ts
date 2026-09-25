import { yardsToMetres } from '@caddymate/engine';
import type { Db } from './client.js';
import { check, must, num } from './errors.js';
import type { Club, ClubKind, Row, Tables } from './types.js';

export function clubFromRow(r: Row<'clubs'>): Club {
  return {
    id: r.club_id,
    name: r.name,
    kind: r.kind,
    loftDeg: num(r.loft_deg),
    bagOrder: r.bag_order,
    active: r.active,
    stockTotalM: num(r.stock_total_m),
    stockCarryM: num(r.stock_carry_m),
    simNameAliases: r.sim_name_aliases,
  };
}

function clubToRow(userId: string, c: ClubInput): Tables['clubs']['Insert'] {
  return {
    ...(c.id ? { club_id: c.id } : {}),
    user_id: userId,
    name: c.name,
    kind: c.kind,
    loft_deg: c.loftDeg ?? null,
    bag_order: c.bagOrder,
    active: c.active ?? true,
    stock_total_m: c.stockTotalM ?? null,
    stock_carry_m: c.stockCarryM ?? null,
    sim_name_aliases: c.simNameAliases ?? [],
  };
}

export type ClubInput = Pick<Club, 'name' | 'kind' | 'bagOrder'> &
  Partial<Omit<Club, 'name' | 'kind' | 'bagOrder'>>;

/** The user's clubs in bag order (RLS scopes to the signed-in user). */
export async function listClubs(db: Db, opts: { activeOnly?: boolean } = {}): Promise<Club[]> {
  let q = db.from('clubs').select('*').order('bag_order').order('name');
  if (opts.activeOnly) q = q.eq('active', true);
  return must(await q, 'listClubs').map(clubFromRow);
}

/** Insert or update clubs (matched on club_id when given, else on (user_id, name)). */
export async function upsertClubs(db: Db, userId: string, clubs: ClubInput[]): Promise<Club[]> {
  if (clubs.length === 0) return [];
  const withId = clubs.filter((c) => c.id);
  const withoutId = clubs.filter((c) => !c.id);
  const out: Club[] = [];
  if (withId.length) {
    const rows = must(
      await db
        .from('clubs')
        .upsert(
          withId.map((c) => clubToRow(userId, c)),
          { onConflict: 'club_id' },
        )
        .select('*'),
      'upsertClubs',
    );
    out.push(...rows.map(clubFromRow));
  }
  if (withoutId.length) {
    const rows = must(
      await db
        .from('clubs')
        .upsert(
          withoutId.map((c) => clubToRow(userId, c)),
          { onConflict: 'user_id,name' },
        )
        .select('*'),
      'upsertClubs',
    );
    out.push(...rows.map(clubFromRow));
  }
  return out.sort((a, b) => a.bagOrder - b.bagOrder);
}

export async function upsertClub(db: Db, userId: string, club: ClubInput): Promise<Club> {
  const [c] = await upsertClubs(db, userId, [club]);
  if (!c) throw new Error('upsertClub: no row returned');
  return c;
}

export async function deleteClub(db: Db, clubId: string): Promise<void> {
  check(await db.from('clubs').delete().eq('club_id', clubId), 'deleteClub');
}

/** Persist a new bag order: `orderedIds[i]` gets bag_order i. */
export async function reorderClubs(db: Db, orderedIds: string[]): Promise<void> {
  const results = await Promise.all(
    orderedIds.map((id, i) => db.from('clubs').update({ bag_order: i }).eq('club_id', id)),
  );
  for (const r of results) check(r, 'reorderClubs');
}

// ---------------------------------------------------------------------------
// Default bag (docs/SPEC.md §2)
// ---------------------------------------------------------------------------

/** Stock-distance anchors from the player's stated distances: (loft°, yards). */
export const STOCK_ANCHORS: readonly (readonly [number, number])[] = [
  [9, 240], // Driver
  [30.5, 160], // 7i (P790)
  [44.5, 120], // PW
];

/**
 * Piecewise-linear stock total (yards) by loft through the anchors, extended
 * linearly beyond the outer anchors. Used to seed clubs the player hasn't
 * given a distance for (SPEC Q5).
 */
export function interpolateStockYards(
  loftDeg: number,
  anchors: readonly (readonly [number, number])[] = STOCK_ANCHORS,
): number {
  const pts = [...anchors].sort((a, b) => a[0] - b[0]);
  if (pts.length === 0) return 0;
  if (pts.length === 1) return pts[0]![1];
  let i = 0;
  while (i < pts.length - 2 && loftDeg > pts[i + 1]![0]) i++;
  const [x0, y0] = pts[i]!;
  const [x1, y1] = pts[i + 1]!;
  return y0 + ((loftDeg - x0) * (y1 - y0)) / (x1 - x0);
}

interface BagTemplate {
  name: string;
  kind: ClubKind;
  loftDeg: number;
}

/** Driver 9°, 5W, 4H, P790 5i–PW, 50/54/60 wedges, putter. */
export const DEFAULT_BAG: readonly BagTemplate[] = [
  { name: 'Driver', kind: 'driver', loftDeg: 9 },
  { name: '5W', kind: 'wood', loftDeg: 18 },
  { name: '4H', kind: 'hybrid', loftDeg: 22 },
  { name: '5i', kind: 'iron', loftDeg: 23.5 },
  { name: '6i', kind: 'iron', loftDeg: 26.5 },
  { name: '7i', kind: 'iron', loftDeg: 30.5 },
  { name: '8i', kind: 'iron', loftDeg: 34.5 },
  { name: '9i', kind: 'iron', loftDeg: 39.5 },
  { name: 'PW', kind: 'wedge', loftDeg: 44.5 },
  { name: '50°', kind: 'wedge', loftDeg: 50 },
  { name: '54°', kind: 'wedge', loftDeg: 54 },
  { name: '60°', kind: 'wedge', loftDeg: 60 },
  { name: 'Putter', kind: 'putter', loftDeg: 3 },
];

/** The default bag as club inputs with loft-interpolated stock totals (metres, 0.1 m). */
export function defaultBag(): ClubInput[] {
  return DEFAULT_BAG.map((c, i) => ({
    name: c.name,
    kind: c.kind,
    loftDeg: c.loftDeg,
    bagOrder: i,
    active: true,
    stockTotalM:
      c.kind === 'putter'
        ? null
        : Math.round(yardsToMetres(Math.round(interpolateStockYards(c.loftDeg))) * 10) / 10,
    stockCarryM: null,
    simNameAliases: [],
  }));
}

/** Create the spec §2 bag for a user (idempotent on club name). */
export async function seedDefaultBag(db: Db, userId: string): Promise<Club[]> {
  return upsertClubs(db, userId, defaultBag());
}
