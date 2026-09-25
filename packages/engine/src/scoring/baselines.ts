/**
 * Expected-strokes baselines `E(category, distance)` (docs/SPEC.md §9.1).
 *
 * Sources and assumptions:
 * - Shape and scratch-level values follow Mark Broadie's strokes-gained
 *   benchmarks ("Every Shot Counts", 2014, and the PGA Tour ShotLink baseline
 *   tables published with it), converted from yards/feet to metres and lightly
 *   smoothed so every table is non-decreasing in distance (Broadie's raw sand
 *   and tee columns have small dips at 60–140 yd that are sampling noise).
 * - "Scratch" is pitched a touch above Tour level for the long game (fairway
 *   137 m ≈ 2.98 vs. Tour ≈ 2.93) and matches Tour-ish putting make rates at
 *   1–3 m (1 m ≈ 1.01, 3 m ≈ 1.49, 10 m ≈ 1.90).
 * - Handicap bands add a per-category "strokes lost vs. scratch" curve scaled
 *   linearly with handicap (`hcp / 15`). The 15-handicap curve is taken from
 *   Broadie's scratch-vs-bogey-golfer comparisons (e.g. fairway 150 yd:
 *   ≈ +0.37, sand 30 yd: ≈ +0.4, 3 m putt: ≈ +0.12). Linear scaling across
 *   bands matches his observation that strokes lost per category grow roughly
 *   in proportion to handicap. Result: 15-hcp fairway 137 m ≈ 3.35.
 * - Distances are metres to the hole; values are expected strokes to hole out,
 *   penalties excluded (callers add them, §9.1).
 */
import type { Lie } from '../types/index.js';

export type SgLieCategory = 'tee' | 'fairway' | 'rough' | 'sand' | 'recovery' | 'green';

export const SG_LIE_CATEGORIES: readonly SgLieCategory[] = [
  'tee',
  'fairway',
  'rough',
  'sand',
  'recovery',
  'green',
];

export type BaselineId = 'scratch' | 'hcp10' | 'hcp15' | 'hcp20';

export const BASELINE_IDS: readonly BaselineId[] = ['scratch', 'hcp10', 'hcp15', 'hcp20'];

/** `[distance_m, expected_strokes]`, sorted by strictly increasing distance. */
export type BaselinePoint = readonly [distanceM: number, expectedStrokes: number];

export type BaselineTable = Readonly<Record<SgLieCategory, readonly BaselinePoint[]>>;

/** Scratch baseline, metres. */
const SCRATCH: BaselineTable = {
  tee: [
    [90, 2.92],
    [110, 2.97],
    [130, 2.99],
    [150, 3.02],
    [165, 3.06],
    [180, 3.1],
    [200, 3.17],
    [220, 3.3],
    [240, 3.55],
    [260, 3.7],
    [280, 3.8],
    [300, 3.87],
    [320, 3.92],
    [340, 3.96],
    [370, 4.02],
    [400, 4.12],
    [430, 4.26],
    [460, 4.44],
    [490, 4.6],
    [520, 4.72],
    [550, 4.8],
    [600, 4.9],
  ],
  fairway: [
    [5, 2.1],
    [10, 2.25],
    [18, 2.4],
    [27, 2.5],
    [37, 2.6],
    [46, 2.66],
    [55, 2.71],
    [73, 2.78],
    [91, 2.84],
    [110, 2.9],
    [128, 2.95],
    [137, 2.98],
    [146, 3.01],
    [165, 3.08],
    [183, 3.17],
    [201, 3.28],
    [219, 3.4],
    [238, 3.52],
    [256, 3.63],
    [274, 3.73],
    [300, 3.85],
    [350, 4.02],
    [400, 4.15],
    [450, 4.35],
    [500, 4.55],
    [550, 4.72],
  ],
  rough: [
    [5, 2.25],
    [10, 2.4],
    [18, 2.59],
    [27, 2.68],
    [37, 2.78],
    [55, 2.91],
    [73, 2.96],
    [91, 3.02],
    [110, 3.08],
    [128, 3.15],
    [137, 3.19],
    [146, 3.23],
    [165, 3.31],
    [183, 3.42],
    [201, 3.53],
    [219, 3.64],
    [238, 3.74],
    [256, 3.84],
    [274, 3.94],
    [300, 4.05],
    [350, 4.2],
    [400, 4.35],
    [450, 4.5],
    [500, 4.65],
    [550, 4.8],
  ],
  sand: [
    [5, 2.35],
    [10, 2.43],
    [18, 2.53],
    [27, 2.65],
    [37, 2.82],
    [55, 3.1],
    [73, 3.2],
    [91, 3.23],
    [110, 3.24],
    [128, 3.25],
    [146, 3.28],
    [165, 3.4],
    [183, 3.55],
    [201, 3.7],
    [219, 3.84],
    [238, 3.95],
    [256, 4.05],
    [300, 4.25],
    [400, 4.55],
    [550, 5],
  ],
  recovery: [
    [5, 2.7],
    [18, 2.9],
    [37, 3.2],
    [55, 3.45],
    [73, 3.65],
    [91, 3.75],
    [128, 3.79],
    [165, 3.81],
    [183, 3.84],
    [201, 3.88],
    [219, 3.92],
    [238, 3.97],
    [256, 4.03],
    [300, 4.15],
    [400, 4.45],
    [550, 4.9],
  ],
  green: [
    [0, 1],
    [0.5, 1],
    [1, 1.01],
    [1.5, 1.1],
    [2, 1.22],
    [2.5, 1.37],
    [3, 1.49],
    [4, 1.63],
    [5, 1.72],
    [6, 1.78],
    [8, 1.85],
    [10, 1.9],
    [12, 1.95],
    [15, 2.01],
    [20, 2.1],
    [25, 2.18],
    [30, 2.26],
    [40, 2.38],
    [60, 2.6],
  ],
};

/** Strokes a 15-handicap loses to scratch, by category and distance (non-decreasing). */
const HCP15_PENALTY: BaselineTable = {
  tee: [
    [90, 0.3],
    [150, 0.35],
    [200, 0.4],
    [300, 0.55],
    [400, 0.7],
    [550, 0.85],
  ],
  fairway: [
    [5, 0.1],
    [27, 0.2],
    [55, 0.28],
    [91, 0.33],
    [137, 0.37],
    [183, 0.45],
    [250, 0.55],
    [350, 0.65],
    [550, 0.8],
  ],
  rough: [
    [5, 0.12],
    [27, 0.25],
    [91, 0.38],
    [137, 0.45],
    [183, 0.55],
    [250, 0.65],
    [550, 0.9],
  ],
  sand: [
    [5, 0.25],
    [27, 0.4],
    [91, 0.5],
    [137, 0.55],
    [250, 0.7],
    [550, 0.9],
  ],
  recovery: [
    [5, 0.2],
    [91, 0.4],
    [183, 0.5],
    [550, 0.8],
  ],
  green: [
    [0, 0],
    [0.5, 0],
    [1, 0.02],
    [2, 0.08],
    [3, 0.12],
    [5, 0.14],
    [10, 0.16],
    [20, 0.2],
    [60, 0.3],
  ],
};

const round3 = (x: number): number => Math.round(x * 1000) / 1000;

/** Linear interpolation over a sorted table, clamped to its end points. */
export function interpolate(points: readonly BaselinePoint[], distanceM: number): number {
  if (Number.isNaN(distanceM)) throw new RangeError('distanceM must be a number');
  if (points.length === 0) throw new RangeError('empty baseline table');
  const first = points[0]!;
  if (distanceM <= first[0]) return first[1];
  for (let i = 1; i < points.length; i++) {
    const [d1, e1] = points[i]!;
    if (distanceM <= d1) {
      const [d0, e0] = points[i - 1]!;
      return e0 + ((e1 - e0) * (distanceM - d0)) / (d1 - d0);
    }
  }
  return points[points.length - 1]![1];
}

function bandTable(hcp: number): BaselineTable {
  const k = hcp / 15;
  const out = {} as Record<SgLieCategory, readonly BaselinePoint[]>;
  for (const cat of SG_LIE_CATEGORIES) {
    out[cat] = SCRATCH[cat].map(([d, e]): BaselinePoint => [
      d,
      round3(e + k * interpolate(HCP15_PENALTY[cat], d)),
    ]);
  }
  return out;
}

export const BASELINES: Readonly<Record<BaselineId, BaselineTable>> = {
  scratch: SCRATCH,
  hcp10: bandTable(10),
  hcp15: bandTable(15),
  hcp20: bandTable(20),
};

/** Nearest published band for a handicap index (plus handicaps → scratch). */
export function baselineForHandicap(handicapIndex: number): BaselineId {
  if (handicapIndex < 5) return 'scratch';
  if (handicapIndex < 12.5) return 'hcp10';
  if (handicapIndex < 17.5) return 'hcp15';
  return 'hcp20';
}

/** Map a recorded lie (§6.3) to its strokes-gained baseline category. */
export function lieToSgCategory(lie: Lie): SgLieCategory {
  switch (lie) {
    case 'tee':
    case 'fairway':
    case 'sand':
    case 'rough':
    case 'green':
      return lie;
    case 'first_cut':
    case 'hardpan':
      return 'fairway';
    case 'deep_rough':
      return 'rough';
    case 'pine_straw':
      return 'recovery';
  }
}

const resolve = (baseline: BaselineTable | BaselineId): BaselineTable =>
  typeof baseline === 'string' ? BASELINES[baseline] : baseline;

/** Expected strokes to hole out from `distanceM` in `category`. */
export function expectedStrokes(
  baseline: BaselineTable | BaselineId,
  category: SgLieCategory,
  distanceM: number,
): number {
  return interpolate(resolve(baseline)[category], distanceM);
}

/** Throws unless `points` is non-empty with strictly increasing distances. */
function assertSorted(points: readonly BaselinePoint[]): void {
  if (points.length === 0) throw new RangeError('empty baseline table');
  for (let i = 1; i < points.length; i++) {
    if (!(points[i]![0] > points[i - 1]![0])) {
      throw new RangeError('baseline distances must be strictly increasing');
    }
  }
}

/**
 * Overlay a player's own (`self`) tables on a band baseline. Categories absent
 * from `self` fall back to the band. The caller decides which categories have
 * enough shots to qualify (§9.1: ≥ 40 per category + distance band).
 */
export function overlayBaseline(
  base: BaselineTable | BaselineId,
  self: Partial<Record<SgLieCategory, readonly BaselinePoint[]>>,
): BaselineTable {
  const out = { ...resolve(base) };
  for (const cat of SG_LIE_CATEGORIES) {
    const pts = self[cat];
    if (pts === undefined) continue;
    assertSorted(pts);
    out[cat] = pts;
  }
  return out;
}

/** A row of `sg_baselines` (§6.3). */
export interface SgBaselineRow {
  baseline_id: string;
  category: SgLieCategory;
  distance_m: number;
  expected_strokes: number;
}

/**
 * Flatten baseline tables into `sg_baselines` rows. Defaults to the four
 * published bands; pass e.g. `{ 'self:<user_id>': table }` for a player table.
 * Values are rounded to the column precision (numeric(6,1), numeric(5,3)).
 */
export function toBaselineRows(
  tables: Readonly<Record<string, BaselineTable>> = BASELINES,
): SgBaselineRow[] {
  const rows: SgBaselineRow[] = [];
  for (const [baselineId, table] of Object.entries(tables)) {
    for (const category of SG_LIE_CATEGORIES) {
      for (const [d, e] of table[category]) {
        rows.push({
          baseline_id: baselineId,
          category,
          distance_m: Math.round(d * 10) / 10,
          expected_strokes: round3(e),
        });
      }
    }
  }
  return rows;
}

/**
 * Inverse of {@link toBaselineRows}: rebuild (possibly partial) tables from
 * `sg_baselines` rows. Postgres `numeric` may arrive as a string.
 */
export function fromBaselineRows(
  rows: readonly {
    baseline_id: string;
    category: SgLieCategory;
    distance_m: number | string;
    expected_strokes: number | string;
  }[],
): Record<string, Partial<Record<SgLieCategory, BaselinePoint[]>>> {
  const out: Record<string, Partial<Record<SgLieCategory, BaselinePoint[]>>> = {};
  for (const r of rows) {
    const table = (out[r.baseline_id] ??= {});
    (table[r.category] ??= []).push([Number(r.distance_m), Number(r.expected_strokes)]);
  }
  for (const table of Object.values(out)) {
    for (const pts of Object.values(table)) pts.sort((a, b) => a[0] - b[0]);
  }
  return out;
}
