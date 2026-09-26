/**
 * Worst-five map thumbnails (docs/SPEC.md §14 "worst five decisions"): a
 * tiny schematic of one shot — hole outline (fairway, green, bunkers, water)
 * in local metres, the aim line, the 80 % ellipse and the shot itself —
 * projected into a `width × height` pixel box for react-native-svg. The shot
 * plays "up" (line-up view, like Replay): the frame is the club frame of
 * start → aim (§4, +lateral right), so a miss right draws right. Pure.
 */
import type { Hole, RoundReview } from '@caddymate/api';
import { initialBearingDeg, toClubFrame, type ClubPattern, type LatLng } from '@caddymate/engine';
import { replayShots, type ReplayShot } from './review';

export interface Pt {
  x: number;
  y: number;
}

export type ThumbShapeKind = 'fairway' | 'green' | 'bunker' | 'water';

export interface ThumbShape {
  kind: ThumbShapeKind;
  /** SVG `points` attribute ("x,y x,y …"). */
  points: string;
}

export interface ShotThumbnail {
  width: number;
  height: number;
  /** Pixels per metre. */
  scale: number;
  /** Background first: fairway, water, bunker, green. */
  shapes: ThumbShape[];
  ellipse: string | null;
  start: Pt;
  end: Pt | null;
  aim: Pt | null;
  pin: Pt | null;
}

export interface ThumbBox {
  width: number;
  height: number;
  /** Inner margin in pixels. */
  padding?: number;
  /** Smallest span shown, in metres, so a chip isn't blown up to fill the box. */
  minSpanM?: number;
}

const SHAPE_ORDER: Record<ThumbShapeKind, number> = { fairway: 0, water: 1, bunker: 2, green: 3 };

const shapeKind = (kind: string): ThumbShapeKind | null =>
  kind === 'fairway' || kind === 'first_cut'
    ? 'fairway'
    : kind === 'bunker'
      ? 'bunker'
      : kind === 'water'
        ? 'water'
        : null;

const r1 = (n: number) => Math.round(n * 10) / 10;

/**
 * Project one replay frame into a thumbnail, or null when the shot has no
 * start (nothing to anchor the frame on). The view fits the shot geometry
 * (start, end, aim, ellipse); course shapes outside it are dropped.
 */
export function shotThumbnail(
  frame: Pick<ReplayShot, 'start' | 'end' | 'aim' | 'ellipse'>,
  hole: Pick<Hole, 'green' | 'features'> | null,
  pin: LatLng | null,
  box: ThumbBox,
): ShotThumbnail | null {
  const { start, end, aim, ellipse } = frame;
  if (!start) return null;
  const toward = aim ?? end ?? pin;
  const bearing = toward ? initialBearingDeg(start, toward) : 0;
  // Club frame → metres with x right, y up.
  const local = (p: LatLng) => {
    const f = toClubFrame(start, bearing, p);
    return { x: f.lateralM, y: f.alongM };
  };

  const fitPts = [start, end, aim, ...(ellipse ?? [])]
    .filter((p): p is LatLng => p !== null)
    .map(local);
  const minSpan = box.minSpanM ?? 40;
  const xs = fitPts.map((p) => p.x);
  const ys = fitPts.map((p) => p.y);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
  const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  const spanX = Math.max(Math.max(...xs) - Math.min(...xs), minSpan);
  const spanY = Math.max(Math.max(...ys) - Math.min(...ys), minSpan);
  const pad = box.padding ?? 8;
  const scale = Math.min((box.width - 2 * pad) / spanX, (box.height - 2 * pad) / spanY);

  const px = (m: { x: number; y: number }): Pt => ({
    x: r1(box.width / 2 + (m.x - cx) * scale),
    y: r1(box.height / 2 - (m.y - cy) * scale),
  });
  const project = (p: LatLng) => px(local(p));
  const pointsAttr = (ring: readonly Pt[]) => ring.map((p) => `${p.x},${p.y}`).join(' ');
  const visible = (ring: readonly Pt[]) =>
    ring.some((p) => p.x >= 0 && p.x <= box.width && p.y >= 0 && p.y <= box.height) ||
    // A shape that covers the whole box (a fairway under a short shot) has no vertex inside.
    (Math.min(...ring.map((p) => p.x)) < 0 &&
      Math.max(...ring.map((p) => p.x)) > box.width &&
      Math.min(...ring.map((p) => p.y)) < 0 &&
      Math.max(...ring.map((p) => p.y)) > box.height);

  const shapes: ThumbShape[] = [];
  const add = (kind: ThumbShapeKind, outer: readonly LatLng[]) => {
    if (outer.length < 3) return;
    const ring = outer.map(project);
    if (visible(ring)) shapes.push({ kind, points: pointsAttr(ring) });
  };
  for (const f of hole?.features ?? []) {
    const kind = shapeKind(f.kind);
    if (kind && f.polygon) add(kind, f.polygon.outer);
  }
  if (hole?.green) add('green', hole.green.outer);
  shapes.sort((a, b) => SHAPE_ORDER[a.kind] - SHAPE_ORDER[b.kind]);

  return {
    width: box.width,
    height: box.height,
    scale,
    shapes,
    ellipse: ellipse && ellipse.length > 2 ? pointsAttr(ellipse.map(project)) : null,
    start: project(start),
    end: end ? project(end) : null,
    aim: aim ? project(aim) : null,
    pin: pin ? project(pin) : null,
  };
}

export interface WorstShotView {
  shotId: string;
  holeNumber: number;
  frame: ReplayShot | null;
  pin: LatLng | null;
}

/** The replay frame (aim, ellipse, start/end) of each of the round's most expensive shots. */
export function worstShotFrames(
  review: Pick<RoundReview, 'holes' | 'mostExpensive' | 'clubLabels' | 'round'>,
  patterns: ReadonlyMap<string, ClubPattern>,
  holes: readonly Pick<Hole, 'number' | 'greenCentre'>[],
): WorstShotView[] {
  const byHole = new Map<number, ReplayShot[]>();
  return review.mostExpensive.map(({ shot }) => {
    const n = shot.holeNumber;
    let frames = byHole.get(n);
    if (!frames) {
      const h = review.holes.find((x) => x.number === n);
      frames = h ? replayShots(h, patterns, review.clubLabels) : [];
      byHole.set(n, frames);
    }
    const pin =
      review.round.pinOverrides[String(n)] ??
      holes.find((h) => h.number === n)?.greenCentre ??
      null;
    return {
      shotId: shot.shotId,
      holeNumber: n,
      frame: frames.find((f) => f.id === shot.shotId) ?? null,
      pin,
    };
  });
}
