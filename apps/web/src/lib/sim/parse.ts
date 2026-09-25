/**
 * Simulator CSV parser for the import PREVIEW (docs/SPEC.md §12). The
 * `import-sim` Edge Function re-parses the uploaded text and is the source of
 * truth; this mirrors its rules so the page can show detected columns, row
 * counts and per-club counts, and ask for club aliases, before anything is
 * written.
 *
 * Detection rules:
 * - Delimiter: whichever of `,` `;` tab occurs most (outside quotes) in the
 *   first non-empty line. RFC 4180 quoting, CRLF and a UTF-8 BOM are handled.
 * - Header row: the first of the first 10 rows that names a club column and a
 *   carry or total column (title lines above it are skipped, and their text
 *   counts towards format detection).
 * - Columns: headers are normalised (lower case, units in `()`/`[]` or a
 *   trailing unit word split off, then letters and digits only) and matched
 *   against the synonym lists below, earliest synonym wins.
 * - Units per distance column: the header's unit, else a units row directly
 *   under the header, else a `units` column per row, else a unit suffix on the
 *   cell itself ("152 yds"), else yards (both sims default to yards).
 *   A suffix on the cell always wins. Everything is returned in metres.
 * - Offline: + right, − left. "12 L" / "L12" read as −12, "R 12" as +12.
 * - Format: header/title signatures score GSPro vs Square; the file name
 *   breaks ties; otherwise `null` and the user picks.
 */
import { feetToMetres, yardsToMetres } from '@caddymate/engine';

export type SimFormat = 'gspro' | 'square';
export type DistanceUnit = 'yd' | 'm' | 'ft';
export type SimField = 'club' | 'timestamp' | 'carry' | 'total' | 'offline';
export type DistanceField = 'carry' | 'total' | 'offline';

export const SIM_FIELDS: readonly SimField[] = ['club', 'timestamp', 'carry', 'total', 'offline'];

/** Normalised header keys per field, in priority order. */
export const HEADER_SYNONYMS: Readonly<Record<SimField, readonly string[]>> = {
  club: ['club', 'clubname', 'clubtype', 'clubused', 'clubdescription'],
  timestamp: [
    'timestamp',
    'datetime',
    'dateandtime',
    'shotdatetime',
    'shottime',
    'shotdate',
    'createdat',
    'recordedat',
    'date',
    'time',
  ],
  carry: ['carry', 'carrydistance', 'carrydist', 'carrylength'],
  total: ['total', 'totaldistance', 'totaldist', 'totallength', 'distance'],
  offline: [
    'offline',
    'offlinedistance',
    'lateral',
    'side',
    'sidedistance',
    'deviation',
    'totaloffline',
    'offlinetotal',
    'totalside',
    'sidetotal',
    'totaldeviation',
    'totallateral',
    'carryoffline',
    'offlinecarry',
    'carryside',
    'sidecarry',
    'carrydeviation',
    'carrylateral',
  ],
};

/** Header keys typical of one sim's export (best knowledge, unverified against real files). */
const FORMAT_SIGNATURES: Readonly<Record<SimFormat, readonly string[]>> = {
  gspro: ['hla', 'vla', 'player', 'playername', 'totaldist', 'offline', 'shotnumber', 'gspro'],
  square: [
    'launchdirection',
    'sidecarry',
    'carrydistance',
    'totaldistance',
    'clubtype',
    'squaregolf',
    'square',
  ],
};

/** Club cells that are summary lines, not shots. */
const SUMMARY_ROWS = new Set(['average', 'avg', 'mean', 'total', 'stddev', 'std', 'median']);

const UNIT_WORDS: Readonly<Record<string, DistanceUnit>> = {
  yd: 'yd',
  yds: 'yd',
  yard: 'yd',
  yards: 'yd',
  m: 'm',
  meter: 'm',
  meters: 'm',
  metre: 'm',
  metres: 'm',
  ft: 'ft',
  feet: 'ft',
};

export interface ColumnMatch {
  index: number;
  header: string;
}

export interface ParsedSimShot {
  /** 1-based line number of the row in the file (for messages). */
  row: number;
  club: string;
  /** ISO timestamp, or null when the file has none / it did not parse. */
  timestamp: string | null;
  carryM: number | null;
  totalM: number | null;
  /** + right of the target line, − left. */
  offlineM: number | null;
}

export interface SkippedRow {
  row: number;
  reason: string;
}

export interface SimParseResult {
  format: SimFormat | null;
  formatReason: string;
  delimiter: string;
  /** 1-based line of the header row, or 0 when none was found. */
  headerRow: number;
  headers: string[];
  columns: Record<SimField, ColumnMatch | null>;
  /** Unit each distance column was read in, and how that was decided. */
  units: Record<DistanceField, { unit: DistanceUnit; source: UnitSource } | null>;
  shots: ParsedSimShot[];
  skipped: SkippedRow[];
  /** Shots per sim club name, most first. */
  perClub: { club: string; count: number }[];
  /** Fatal problems (no header / no club column); `shots` is empty then. */
  errors: string[];
  /** Non-fatal notes (e.g. no offline column). */
  warnings: string[];
}

export type UnitSource = 'header' | 'units-row' | 'units-column' | 'cell' | 'default';

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

/** Delimiter with the most occurrences outside quotes in the first non-empty line. */
export function detectDelimiter(text: string): string {
  const line = text.split(/\r?\n/).find((l) => l.trim() !== '') ?? '';
  let best = ',';
  let bestCount = 0;
  for (const d of [',', ';', '\t']) {
    let n = 0;
    let quoted = false;
    for (const ch of line) {
      if (ch === '"') quoted = !quoted;
      else if (ch === d && !quoted) n++;
    }
    if (n > bestCount) {
      best = d;
      bestCount = n;
    }
  }
  return best;
}

/** RFC 4180 rows (quotes, doubled quotes, CRLF, newlines inside quotes). */
export function parseCsv(text: string, delimiter = detectDelimiter(text)): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  const src = text.replace(/^﻿/, '');
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delimiter) {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Headers, units, values
// ---------------------------------------------------------------------------

export interface NormalisedHeader {
  key: string;
  unit: DistanceUnit | null;
}

/** "Carry (yds)" → { key: 'carry', unit: 'yd' }; "Total Distance m" → { 'totaldistance', 'm' }. */
export function normaliseHeader(raw: string): NormalisedHeader {
  let s = raw.trim().toLowerCase();
  let unit: DistanceUnit | null = null;
  const bracket = /[([]\s*([a-z]+)\s*[)\]]/.exec(s);
  if (bracket) {
    unit = UNIT_WORDS[bracket[1]!] ?? null;
    s = s.replace(bracket[0], ' ');
  }
  const words = s.split(/[^a-z0-9]+/).filter(Boolean);
  // A trailing unit word ("carry yds") — but never the whole header ("m").
  const last = words[words.length - 1];
  if (!unit && words.length > 1 && last && UNIT_WORDS[last]) {
    unit = UNIT_WORDS[last];
    words.pop();
  }
  return { key: words.join(''), unit };
}

/** A unit token on its own ("yds", "(m)", "Meters"), or null. */
export function unitToken(cell: string): DistanceUnit | null {
  const t = cell
    .trim()
    .toLowerCase()
    .replace(/[()[\]\s.]/g, '');
  return UNIT_WORDS[t] ?? null;
}

export interface ParsedNumber {
  value: number;
  unit: DistanceUnit | null;
}

/**
 * A distance cell: optional sign, L/R side marker (L = negative), decimal
 * comma, and a unit suffix. Returns null for blanks and non-numbers.
 */
export function parseDistanceCell(raw: string): ParsedNumber | null {
  let s = raw.trim().toLowerCase();
  if (s === '' || s === '-' || s === 'n/a' || s === 'na') return null;
  let sign = 1;
  const lead = /^([lr])\s*(\d.*)$/.exec(s);
  const trail = /^(.*\d\.?)\s*([lr])$/.exec(s);
  if (lead) {
    if (lead[1] === 'l') sign = -1;
    s = lead[2]!.trim();
  } else if (trail) {
    if (trail[2] === 'l') sign = -1;
    s = trail[1]!.trim();
  }
  let unit: DistanceUnit | null = null;
  const suffix = /^(.*?)\s*([a-z]+)\.?$/.exec(s);
  if (suffix && UNIT_WORDS[suffix[2]!]) {
    unit = UNIT_WORDS[suffix[2]!]!;
    s = suffix[1]!.trim();
  }
  if (/^[-+]?\d+,\d+$/.test(s)) s = s.replace(',', '.');
  if (!/^[-+]?(\d+\.?\d*|\.\d+)$/.test(s)) return null;
  const value = Number(s) * sign;
  return Number.isFinite(value) ? { value, unit } : null;
}

export function toMetres(value: number, unit: DistanceUnit): number {
  if (unit === 'm') return value;
  if (unit === 'ft') return feetToMetres(value);
  return yardsToMetres(value);
}

/**
 * Timestamp cell → ISO string. ISO / RFC strings go through `Date.parse`;
 * slash dates are US month/day unless the first part is > 12. Times without
 * a zone are taken as local time. Null when nothing parses.
 */
export function parseTimestamp(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  const slash =
    /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})(?:[ T,]+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([ap]m)?)?$/i.exec(
      s,
    );
  if (slash) {
    let a = Number(slash[1]);
    let b = Number(slash[2]);
    if (a > 12) [a, b] = [b, a]; // day/month
    let year = Number(slash[3]);
    if (year < 100) year += 2000;
    let hour = Number(slash[4] ?? 0);
    const ampm = slash[7]?.toLowerCase();
    if (ampm === 'pm' && hour < 12) hour += 12;
    if (ampm === 'am' && hour === 12) hour = 0;
    const d = new Date(year, a - 1, b, hour, Number(slash[5] ?? 0), Number(slash[6] ?? 0));
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  const t = Date.parse(/^\d{4}-\d{2}-\d{2} \d/.test(s) ? s.replace(' ', 'T') : s);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------

function matchColumns(headers: readonly string[]): Record<SimField, ColumnMatch | null> {
  const keys = headers.map((h) => normaliseHeader(h).key);
  const used = new Set<number>();
  const out = {} as Record<SimField, ColumnMatch | null>;
  for (const field of SIM_FIELDS) {
    out[field] = null;
    for (const syn of HEADER_SYNONYMS[field]) {
      const index = keys.findIndex((k, i) => k === syn && !used.has(i));
      if (index >= 0) {
        used.add(index);
        out[field] = { index, header: headers[index]! };
        break;
      }
    }
  }
  return out;
}

function looksLikeHeader(row: readonly string[]): boolean {
  const cols = matchColumns(row);
  return cols.club !== null && (cols.carry !== null || cols.total !== null);
}

/** Score the header keys and title lines against each sim's signature. */
export function detectFormat(
  headers: readonly string[],
  preamble: readonly string[] = [],
  fileName = '',
): { format: SimFormat | null; reason: string } {
  const title = preamble.join(' ').toLowerCase();
  if (title.includes('gspro')) return { format: 'gspro', reason: 'title line mentions GSPro' };
  if (title.includes('square')) return { format: 'square', reason: 'title line mentions Square' };
  const keys = new Set(headers.map((h) => normaliseHeader(h).key));
  const score = (f: SimFormat) => FORMAT_SIGNATURES[f].filter((k) => keys.has(k)).length;
  const g = score('gspro');
  const q = score('square');
  if (g > q) return { format: 'gspro', reason: `GSPro-style headers (${String(g)} matched)` };
  if (q > g) return { format: 'square', reason: `Square-style headers (${String(q)} matched)` };
  const name = fileName.toLowerCase();
  if (name.includes('gspro')) return { format: 'gspro', reason: 'file name' };
  if (name.includes('square')) return { format: 'square', reason: 'file name' };
  return { format: null, reason: 'headers do not identify the simulator' };
}

// ---------------------------------------------------------------------------
// Parse
// ---------------------------------------------------------------------------

const DISTANCE_FIELDS: readonly DistanceField[] = ['carry', 'total', 'offline'];
const UNITS_COLUMN_KEYS = ['units', 'unit', 'distanceunits', 'distanceunit'];

export function parseSimCsv(text: string, fileName = ''): SimParseResult {
  const delimiter = detectDelimiter(text);
  const rows = parseCsv(text, delimiter);
  const emptyColumns = Object.fromEntries(SIM_FIELDS.map((f) => [f, null])) as Record<
    SimField,
    ColumnMatch | null
  >;
  const result: SimParseResult = {
    format: null,
    formatReason: '',
    delimiter,
    headerRow: 0,
    headers: [],
    columns: emptyColumns,
    units: { carry: null, total: null, offline: null },
    shots: [],
    skipped: [],
    perClub: [],
    errors: [],
    warnings: [],
  };

  const headerIdx = rows.slice(0, 10).findIndex(looksLikeHeader);
  if (headerIdx < 0) {
    const f = detectFormat(rows[0] ?? [], [], fileName);
    result.format = f.format;
    result.formatReason = f.reason;
    result.errors.push('No header row with a club and a carry/total column in the first 10 lines.');
    return result;
  }
  const headers = rows[headerIdx]!.map((h) => h.trim());
  const preamble = rows.slice(0, headerIdx).map((r) => r.join(' '));
  const columns = matchColumns(headers);
  const fmt = detectFormat(headers, preamble, fileName);
  Object.assign(result, {
    format: fmt.format,
    formatReason: fmt.reason,
    headerRow: headerIdx + 1,
    headers,
    columns,
  });

  // A separate "time" column next to a "date" column is combined with it.
  const keys = headers.map((h) => normaliseHeader(h).key);
  const timeIdx =
    columns.timestamp && keys[columns.timestamp.index] === 'date' ? keys.indexOf('time') : -1;
  const unitsColIdx = keys.findIndex((k) => UNITS_COLUMN_KEYS.includes(k));

  let dataStart = headerIdx + 1;
  const unitsRow = rows[dataStart];
  const rowUnits: Partial<Record<DistanceField, DistanceUnit>> = {};
  if (unitsRow) {
    const tokens = DISTANCE_FIELDS.flatMap((f) => {
      const c = columns[f];
      const u = c ? unitToken(unitsRow[c.index] ?? '') : null;
      if (u) rowUnits[f] = u;
      return u ? [u] : [];
    });
    const numericCarry = columns.carry
      ? parseDistanceCell(unitsRow[columns.carry.index] ?? '')
      : null;
    if (tokens.length > 0 && !numericCarry) dataStart++;
    else for (const f of DISTANCE_FIELDS) delete rowUnits[f];
  }

  for (const f of DISTANCE_FIELDS) {
    const c = columns[f];
    if (!c) continue;
    const header = normaliseHeader(c.header).unit;
    if (header) result.units[f] = { unit: header, source: 'header' };
    else if (rowUnits[f]) result.units[f] = { unit: rowUnits[f], source: 'units-row' };
    else if (unitsColIdx >= 0) result.units[f] = { unit: 'yd', source: 'units-column' };
    else result.units[f] = { unit: 'yd', source: 'default' };
  }
  if (!columns.offline) result.warnings.push('No offline column: shots import without a side.');
  if (!columns.timestamp) result.warnings.push('No timestamp column: rows are dated at import.');

  const counts = new Map<string, number>();
  const sawCellUnit: Partial<Record<DistanceField, DistanceUnit>> = {};
  for (let i = dataStart; i < rows.length; i++) {
    const row = rows[i]!;
    const line = i + 1;
    if (row.every((c) => c.trim() === '')) continue;
    const club = columns.club ? (row[columns.club.index] ?? '').trim() : '';
    if (!club) {
      result.skipped.push({ row: line, reason: 'no club' });
      continue;
    }
    if (SUMMARY_ROWS.has(club.toLowerCase().replace(/[^a-z]/g, ''))) {
      result.skipped.push({ row: line, reason: 'summary row' });
      continue;
    }
    const rowUnit = unitsColIdx >= 0 ? unitToken(row[unitsColIdx] ?? '') : null;
    const dist = (f: DistanceField): number | null => {
      const c = columns[f];
      if (!c) return null;
      const p = parseDistanceCell(row[c.index] ?? '');
      if (!p) return null;
      if (p.unit) sawCellUnit[f] = p.unit;
      const u = result.units[f]!;
      const unit = p.unit ?? (u.source === 'units-column' ? (rowUnit ?? 'yd') : u.unit);
      return Math.round(toMetres(p.value, unit) * 100) / 100;
    };
    const carryM = dist('carry');
    const totalM = dist('total');
    if (carryM === null && totalM === null) {
      result.skipped.push({ row: line, reason: 'no carry or total' });
      continue;
    }
    let timestamp: string | null = null;
    if (columns.timestamp) {
      const raw = row[columns.timestamp.index] ?? '';
      timestamp = parseTimestamp(timeIdx >= 0 ? `${raw} ${row[timeIdx] ?? ''}` : raw);
    }
    result.shots.push({ row: line, club, timestamp, carryM, totalM, offlineM: dist('offline') });
    counts.set(club, (counts.get(club) ?? 0) + 1);
  }
  for (const f of DISTANCE_FIELDS) {
    const u = result.units[f];
    if (u && u.source === 'default' && sawCellUnit[f]) {
      result.units[f] = { unit: sawCellUnit[f], source: 'cell' };
    }
  }
  result.perClub = [...counts]
    .map(([club, count]) => ({ club, count }))
    .sort((a, b) => b.count - a.count || a.club.localeCompare(b.club));
  return result;
}
