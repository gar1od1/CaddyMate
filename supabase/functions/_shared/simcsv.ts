/**
 * Launch-monitor CSV parsing for the sim import (docs/SPEC.md §12): GSPro
 * shot-history exports and Square Golf exports. Columns are found by header
 * synonyms rather than fixed positions, and units come from the header
 * (`Carry (m)`, `Carry [yds]`, `Carry_yd`) or a units row directly under it
 * (GSPro writes `yds`, `mph`, …); distances default to yards. Output is SI:
 * metres, m/s. Lateral (`offline`) is + right; `12.3 L` / `L12.3` / `-12.3`
 * are left.
 */

export type SimFormat = 'gspro' | 'square';
export type DistanceUnit = 'yd' | 'm' | 'ft';
export type SpeedUnit = 'mph' | 'kph' | 'mps';

export interface SimShot {
  /** 1-based line number in the file. */
  line: number;
  /** Club name as the launch monitor wrote it (trimmed). */
  club: string;
  /** ISO 8601 UTC, or null when the file has no usable timestamp for the row. */
  playedAt: string | null;
  carryM: number;
  totalM: number | null;
  /** + right of the target line, metres. */
  offlineM: number | null;
  ballSpeedMps: number | null;
  launchDeg: number | null;
  spinRpm: number | null;
  /** The row's raw cells (kept in `sim_sessions.raw_payload`). */
  raw: string[];
}

export interface SimRejection {
  line: number;
  reason: string;
}

export interface ParsedSimCsv {
  /** Format inferred from the header (null when neither signature matched). */
  detected: SimFormat | null;
  headers: string[];
  delimiter: string;
  units: { distance: Record<'carry' | 'total' | 'offline', DistanceUnit>; speed: SpeedUnit };
  shots: SimShot[];
  rejected: SimRejection[];
}

export interface ParseOptions {
  /** Offset of the export's local clock from UTC, minutes (e.g. +60 for IST). Default 0. */
  utcOffsetMinutes?: number;
}

export class SimCsvError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SimCsvError';
  }
}

// ---------------------------------------------------------------------------
// CSV tokenising
// ---------------------------------------------------------------------------

/** The delimiter of the first non-empty lines: `,`, `;` or tab, by count outside quotes. */
export function detectDelimiter(text: string): string {
  const sample = text
    .split(/\r?\n/)
    .filter((l) => l.trim() !== '')
    .slice(0, 10)
    .join('\n');
  let best = ',';
  let bestCount = -1;
  for (const d of [',', ';', '\t']) {
    let n = 0;
    let quoted = false;
    for (const ch of sample) {
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

/** RFC 4180 rows (quoted fields, doubled quotes, CRLF/LF, BOM). */
export function parseCsvRows(text: string, delimiter = detectDelimiter(text)): string[][] {
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
    } else if (ch === '"' && field.trim() === '') {
      field = '';
      quoted = true;
    } else if (ch === delimiter) {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += ch;
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.map((r) => r.map((c) => c.trim()));
}

// ---------------------------------------------------------------------------
// Header detection
// ---------------------------------------------------------------------------

type Field =
  'club' | 'carry' | 'total' | 'offline' | 'ballSpeed' | 'launch' | 'spin' | 'date' | 'time';

/** Normalised header keys per field, best first. */
export const HEADER_SYNONYMS: Readonly<Record<Field, readonly string[]>> = {
  club: ['club', 'clubname', 'clubtype', 'clubused'],
  carry: ['carry', 'carrydistance', 'carrydist', 'carrylength'],
  total: ['total', 'totaldistance', 'totaldist', 'totallength', 'distance'],
  offline: [
    'offline',
    'totaloffline',
    'offlinetotal',
    'totalside',
    'sidetotal',
    'totaldeviation',
    'totallateral',
    'carryoffline',
    'offlinecarry',
    'sidecarry',
    'carryside',
    'carrydeviation',
    'carrylateral',
    'side',
    'lateral',
    'deviation',
    'offlinedistance',
  ],
  ballSpeed: ['ballspeed', 'ballspd', 'speed'],
  launch: ['launch', 'launchangle', 'vla', 'verticallaunch', 'vertlaunch', 'launchv'],
  spin: ['spin', 'totalspin', 'backspin', 'spinrate'],
  date: ['date', 'datetime', 'dateandtime', 'timestamp', 'shotdate', 'shottime', 'createdat'],
  time: ['time', 'shottimeofday', 'clock'],
};

/** Header keys only one of the two exports writes (heuristic, see README). */
export const FORMAT_SIGNATURES: Readonly<Record<SimFormat, readonly string[]>> = {
  gspro: ['hla', 'vla', 'player', 'spinaxis', 'peakheight', 'descentangle', 'shotkey', 'gspro'],
  square: [
    'clubtype',
    'carrydistance',
    'totaldistance',
    'sidecarry',
    'sidetotal',
    'launchangle',
    'launchdirection',
    'backspin',
    'sidespin',
    'squaregolf',
  ],
};

const UNIT_TOKENS: Record<string, DistanceUnit | SpeedUnit> = {
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
  mph: 'mph',
  kph: 'kph',
  kmh: 'kph',
  'km/h': 'kph',
  'm/s': 'mps',
  mps: 'mps',
};

interface HeaderKey {
  key: string;
  unit: string | null;
}

/** `Carry Distance (yds)` → { key: 'carrydistance', unit: 'yd' }; `carry_m` → carry, m. */
export function normaliseHeader(h: string): HeaderKey {
  let text = h.toLowerCase().trim();
  let unit: string | null = null;
  const bracket = /[([]\s*([^)\]]+?)\s*[)\]]/.exec(text);
  if (bracket) {
    unit = UNIT_TOKENS[bracket[1]!.replace(/\s+/g, '')] ?? null;
    text = text.replace(bracket[0], ' ');
  }
  const words = text.split(/[^a-z0-9/]+/).filter(Boolean);
  const last = words[words.length - 1];
  if (unit === null && words.length > 1 && last !== undefined && UNIT_TOKENS[last]) {
    unit = UNIT_TOKENS[last]!;
    words.pop();
  }
  return { key: words.join('').replace(/\//g, ''), unit };
}

const hasField = (keys: readonly HeaderKey[], f: Field) =>
  keys.some((k) => HEADER_SYNONYMS[f].includes(k.key));

/** Format whose signature headers match best, or null. */
export function detectSimFormat(headers: readonly string[]): SimFormat | null {
  const keys = new Set(headers.map((h) => normaliseHeader(h).key));
  const score = (f: SimFormat) => FORMAT_SIGNATURES[f].filter((k) => keys.has(k)).length;
  const g = score('gspro');
  const s = score('square');
  if (g === 0 && s === 0) return null;
  return g >= s ? 'gspro' : 'square';
}

function columnFor(keys: readonly HeaderKey[], f: Field, taken: Set<number>): number {
  for (const syn of HEADER_SYNONYMS[f]) {
    const i = keys.findIndex((k, j) => k.key === syn && !taken.has(j));
    if (i >= 0) return i;
  }
  return -1;
}

// ---------------------------------------------------------------------------
// Values
// ---------------------------------------------------------------------------

const YD = 0.9144;
const FT = 0.3048;
const toMetres = (v: number, u: DistanceUnit) => (u === 'yd' ? v * YD : u === 'ft' ? v * FT : v);
const toMps = (v: number, u: SpeedUnit) => (u === 'mph' ? v * 0.44704 : u === 'kph' ? v / 3.6 : v);
const round2 = (n: number) => Math.round(n * 100) / 100;

/** A number from a cell (`1,234.5`; `12,5` / `1.234,5` when the file uses `;`), or null. */
export function parseNumber(cell: string | undefined, decimalComma = false): number | null {
  if (cell === undefined) return null;
  let s = cell.trim().replace(/\s+/g, '');
  if (s === '' || s === '-' || /^n\/?a$/i.test(s)) return null;
  s =
    decimalComma && s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  s = s.replace(/[a-z%°]+$/i, '');
  if (!/^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** Lateral with side letters: `12.3 L`, `L12.3`, `12.3R`, `-12.3` (+ right). */
export function parseLateral(cell: string | undefined, decimalComma = false): number | null {
  if (cell === undefined) return null;
  const s = cell.trim();
  const m = /^([LR])\s*(.+)$/i.exec(s) ?? /^(.+?)\s*([LR])$/i.exec(s);
  if (m) {
    const [side, value] = /^[LR]$/i.test(m[1]!) ? [m[1]!, m[2]!] : [m[2]!, m[1]!];
    const n = parseNumber(value, decimalComma);
    if (n === null) return null;
    return side.toUpperCase() === 'L' ? -Math.abs(n) : Math.abs(n);
  }
  return parseNumber(s, decimalComma);
}

/**
 * A timestamp as epoch ms. Accepts ISO 8601 (an explicit `Z`/offset wins),
 * `YYYY-MM-DD HH:MM[:SS]`, `M/D/YYYY h:mm[:ss] [AM|PM]` (D/M when the first
 * part exceeds 12) and `D.M.YYYY HH:MM`; zone-less values are local to the
 * export, shifted by `utcOffsetMinutes`.
 */
export function parseTimestamp(text: string, utcOffsetMinutes = 0): number | null {
  const s = text.trim();
  if (s === '') return null;
  if (/^\d{4}-\d{2}-\d{2}T.*(Z|[+-]\d{2}:?\d{2})$/i.test(s)) {
    const t = Date.parse(s);
    return Number.isNaN(t) ? null : t;
  }
  let y: number, mo: number, d: number;
  let rest: string;
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})[T\s]*(.*)$/.exec(s);
  if (m) {
    [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
    rest = m[4]!;
  } else if ((m = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4}),?\s*(.*)$/.exec(s))) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    [mo, d] = a > 12 ? [b, a] : [a, b];
    y = Number(m[3]) < 100 ? 2000 + Number(m[3]) : Number(m[3]);
    rest = m[4]!;
  } else if ((m = /^(\d{1,2})\.(\d{1,2})\.(\d{4}),?\s*(.*)$/.exec(s))) {
    [d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
    rest = m[4]!;
  } else return null;
  let h = 0;
  let mi = 0;
  let sec = 0;
  if (rest !== '') {
    const t = /^(\d{1,2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?\s*([AaPp][Mm])?$/.exec(rest.trim());
    if (!t) return null;
    [h, mi, sec] = [Number(t[1]), Number(t[2]), Number(t[3] ?? 0)];
    const ampm = t[5]?.toUpperCase();
    if (ampm === 'PM' && h < 12) h += 12;
    if (ampm === 'AM' && h === 12) h = 0;
  }
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || sec > 59) return null;
  return Date.UTC(y, mo - 1, d, h, mi, sec) - utcOffsetMinutes * 60_000;
}

const SUMMARY_ROW = /^(avg|average|mean|total|totals|median|std\.?\s*dev|summary)$/i;

// ---------------------------------------------------------------------------
// Parse
// ---------------------------------------------------------------------------

/**
 * Parse a GSPro / Square Golf export. Throws `SimCsvError` when no header row
 * with a club and a carry column is found in the first 20 lines. Rows without
 * a club or a numeric carry are rejected (summary rows are dropped silently).
 */
export function parseSimCsv(text: string, opts: ParseOptions = {}): ParsedSimCsv {
  const delimiter = detectDelimiter(text);
  const decimalComma = delimiter === ';';
  const rows = parseCsvRows(text, delimiter);
  const headerIdx = rows.slice(0, 20).findIndex((r) => {
    const keys = r.map(normaliseHeader);
    return hasField(keys, 'club') && hasField(keys, 'carry');
  });
  if (headerIdx < 0) {
    throw new SimCsvError('No header row with Club and Carry columns in the first 20 lines');
  }
  const headers = rows[headerIdx]!;
  const keys = headers.map(normaliseHeader);
  const taken = new Set<number>();
  const col = {} as Record<Field, number>;
  for (const f of Object.keys(HEADER_SYNONYMS) as Field[]) {
    col[f] = columnFor(keys, f, taken);
    if (col[f] >= 0) taken.add(col[f]);
  }

  // A units row (GSPro): every non-empty cell is a unit token.
  let first = headerIdx + 1;
  const unitsRow = rows[first];
  const unitCell = (c: string) => UNIT_TOKENS[c.toLowerCase().replace(/[()[\]\s]/g, '')];
  const isUnitsRow =
    unitsRow !== undefined &&
    unitsRow.some((c) => c !== '') &&
    unitsRow.every((c) => c === '' || unitCell(c) !== undefined || /^(deg|°|rpm|%)$/i.test(c));
  if (isUnitsRow) first++;
  const unitOf = (i: number): string | null =>
    i < 0 ? null : (keys[i]!.unit ?? (isUnitsRow ? (unitCell(unitsRow![i] ?? '') ?? null) : null));
  const dist = (i: number): DistanceUnit => {
    const u = unitOf(i);
    return u === 'm' || u === 'ft' ? u : 'yd';
  };
  const speedU = unitOf(col.ballSpeed);
  const units = {
    distance: { carry: dist(col.carry), total: dist(col.total), offline: dist(col.offline) },
    speed: (speedU === 'kph' || speedU === 'mps' ? speedU : 'mph') as SpeedUnit,
  };

  const shots: SimShot[] = [];
  const rejected: SimRejection[] = [];
  const cell = (r: string[], i: number) => (i >= 0 ? r[i] : undefined);
  for (let li = first; li < rows.length; li++) {
    const r = rows[li]!;
    if (r.every((c) => c === '')) continue;
    const line = li + 1;
    const club = cell(r, col.club) ?? '';
    if (SUMMARY_ROW.test(club) || SUMMARY_ROW.test(r[0] ?? '')) continue;
    if (club === '') {
      rejected.push({ line, reason: 'no club' });
      continue;
    }
    const carry = parseNumber(cell(r, col.carry), decimalComma);
    if (carry === null || carry <= 0) {
      rejected.push({ line, reason: 'no carry' });
      continue;
    }
    const total = parseNumber(cell(r, col.total), decimalComma);
    const offline = parseLateral(cell(r, col.offline), decimalComma);
    const speed = parseNumber(cell(r, col.ballSpeed), decimalComma);
    let when: number | null = null;
    const dateText = cell(r, col.date);
    if (dateText) {
      const timeText = cell(r, col.time);
      const combined = timeText && !/\d:\d/.test(dateText) ? `${dateText} ${timeText}` : dateText;
      when = parseTimestamp(combined, opts.utcOffsetMinutes ?? 0);
    }
    shots.push({
      line,
      club,
      playedAt: when === null ? null : new Date(when).toISOString(),
      carryM: round2(toMetres(carry, units.distance.carry)),
      totalM: total === null || total <= 0 ? null : round2(toMetres(total, units.distance.total)),
      offlineM: offline === null ? null : round2(toMetres(offline, units.distance.offline)),
      ballSpeedMps: speed === null ? null : round2(toMps(speed, units.speed)),
      launchDeg: parseNumber(cell(r, col.launch), decimalComma),
      spinRpm: parseNumber(cell(r, col.spin), decimalComma),
      raw: r,
    });
  }
  return { detected: detectSimFormat(headers), headers, delimiter, units, shots, rejected };
}
