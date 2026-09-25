/**
 * Sim club name → bag club mapping (docs/SPEC.md §12). Choices persist in
 * `clubs.sim_name_aliases`: the first import asks, later imports remember.
 */

export interface AliasClub {
  id: string;
  name: string;
  kind: string;
  loftDeg: number | null;
  simNameAliases: readonly string[];
}

export type SuggestionReason = 'remembered' | 'name' | 'matched' | 'loft';

export interface AliasSuggestion {
  clubId: string;
  reason: SuggestionReason;
}

/** Case/space-insensitive comparison key for a sim name. */
export const simNameKey = (s: string): string => s.trim().toLowerCase().replace(/\s+/g, ' ');

/** Nominal lofts for lettered wedges, to match against degree-named bag wedges. */
const LETTER_WEDGE_LOFT: Readonly<Record<string, number>> = { pw: 46, gw: 50, sw: 56, lw: 60 };

/**
 * Canonical club key shared by sims and bags: `driver`, `putter`, `3w`,
 * `4h`, `7i`, `pw`/`gw`/`sw`/`lw`, `56deg`. Null when unrecognised.
 */
export function canonicalClubKey(raw: string): string | null {
  const s = raw.trim().toLowerCase().replace(/[-_]/g, ' ').replace(/\s+/g, ' ');
  if (/^(driver|dr|drv|d|1w|1 wood)$/.test(s)) return 'driver';
  if (/^(putter|pt|pu|putt)$/.test(s)) return 'putter';
  const deg = /^(\d{2})(?:\.\d)?\s*(?:°|deg|degree|degrees)?\s*(?:w|wdg|wedge)?$/.exec(s);
  if (deg && Number(deg[1]) >= 44 && Number(deg[1]) <= 66) return `${deg[1]}deg`;
  if (/^(pw|p|pitching( wedge)?|pitch)$/.test(s)) return 'pw';
  if (/^(gw|aw|uw|g|a|gap( wedge)?|approach( wedge)?)$/.test(s)) return 'gw';
  if (/^(sw|s|sand( wedge)?)$/.test(s)) return 'sw';
  if (/^(lw|l|lob( wedge)?)$/.test(s)) return 'lw';
  const kinds: [RegExp, RegExp, string][] = [
    [/^(\d{1,2})\s*(w|wd|wood|fw|fairway( wood)?)$/, /^(?:w|fw)\s*(\d{1,2})$/, 'w'],
    [/^(\d{1,2})\s*(h|hy|hyb|hybrid|rescue|ut|u|utility)$/, /^(?:h|hy|hyb|u|ut)\s*(\d{1,2})$/, 'h'],
    [/^(\d{1,2})\s*(i|ir|iron)$/, /^(?:i|ir)\s*(\d{1,2})$/, 'i'],
  ];
  for (const [suffix, prefix, k] of kinds) {
    const m = suffix.exec(s) ?? prefix.exec(s);
    if (m) return `${String(Number(m[1]))}${k}`;
  }
  return null;
}

/**
 * Best bag club for a sim name: a remembered alias, then an exact name, then
 * the same canonical key, then (lettered sim wedge → degree bag wedge) the
 * closest loft within 3°.
 */
export function suggestClub(simName: string, clubs: readonly AliasClub[]): AliasSuggestion | null {
  const key = simNameKey(simName);
  const remembered = clubs.find((c) => c.simNameAliases.some((a) => simNameKey(a) === key));
  if (remembered) return { clubId: remembered.id, reason: 'remembered' };
  const named = clubs.find((c) => simNameKey(c.name) === key);
  if (named) return { clubId: named.id, reason: 'name' };
  const canon = canonicalClubKey(simName);
  if (!canon) return null;
  const matched = clubs.find((c) => canonicalClubKey(c.name) === canon);
  if (matched) return { clubId: matched.id, reason: 'matched' };

  const target = LETTER_WEDGE_LOFT[canon] ?? (/^(\d+)deg$/.test(canon) ? parseInt(canon) : null);
  if (target === null) return null;
  let best: AliasClub | null = null;
  let bestDiff = Infinity;
  for (const c of clubs) {
    if (c.kind !== 'wedge') continue;
    const ck = canonicalClubKey(c.name);
    const loft =
      c.loftDeg ??
      (ck && LETTER_WEDGE_LOFT[ck] !== undefined
        ? LETTER_WEDGE_LOFT[ck]
        : ck && /^\d+deg$/.test(ck)
          ? parseInt(ck)
          : null);
    if (loft === null || loft === undefined) continue;
    const diff = Math.abs(loft - target);
    if (diff <= 3 && diff < bestDiff) {
      best = c;
      bestDiff = diff;
    }
  }
  return best ? { clubId: best.id, reason: 'loft' } : null;
}

/** Initial mapping for the import form: every sim name → suggested club id or null (skip). */
export function initialMapping(
  simNames: readonly string[],
  clubs: readonly AliasClub[],
): Record<string, string | null> {
  return Object.fromEntries(simNames.map((n) => [n, suggestClub(n, clubs)?.clubId ?? null]));
}

/** The `clubAliases` payload for `import-sim`: mapped sim names only. */
export function toClubAliases(mapping: Readonly<Record<string, string | null>>) {
  const out: Record<string, string> = {};
  for (const [name, id] of Object.entries(mapping)) if (id) out[name] = id;
  return out;
}

/**
 * New `sim_name_aliases` per club after applying `mapping`: each mapped sim
 * name is added to its club and removed from any other club (a name maps to
 * exactly one club); names mapped to null (skipped) are forgotten. Aliases of
 * names not in this file are kept. Only changed clubs are returned.
 */
export function aliasUpdates(
  clubs: readonly AliasClub[],
  mapping: Readonly<Record<string, string | null>>,
): { clubId: string; aliases: string[] }[] {
  const decided = new Map(Object.entries(mapping).map(([n, id]) => [simNameKey(n), { n, id }]));
  const out: { clubId: string; aliases: string[] }[] = [];
  for (const c of clubs) {
    const kept = c.simNameAliases.filter((a) => {
      const d = decided.get(simNameKey(a));
      return d === undefined || d.id === c.id;
    });
    const have = new Set(kept.map(simNameKey));
    const added = [...decided.values()]
      .filter((d) => d.id === c.id && !have.has(simNameKey(d.n)))
      .map((d) => d.n);
    const next = [...kept, ...added];
    const same =
      next.length === c.simNameAliases.length && next.every((a, i) => a === c.simNameAliases[i]);
    if (!same) out.push({ clubId: c.id, aliases: next });
  }
  return out;
}
