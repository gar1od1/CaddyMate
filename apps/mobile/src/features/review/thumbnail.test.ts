import { newShot, type RoundReview, type Shot } from '@caddymate/api';
import { fitPattern } from '@caddymate/engine';
import { describe, expect, it } from 'vitest';
import { at, HOLE, PIN, TEE } from '@/test/fixtures';
import { shotEllipse } from './review';
import { shotThumbnail, worstShotFrames } from './thumbnail';

const BOX = { width: 120, height: 90, padding: 8 };
const pattern = fitPattern([], {
  prior: { n0: 8, distance: { mean: 150, sd: 8 }, lateral: { mean: 2, sd: 9 } },
});

describe('shotThumbnail', () => {
  it('returns null without a start', () => {
    expect(
      shotThumbnail({ start: null, end: at(10), aim: null, ellipse: null }, HOLE, PIN, BOX),
    ).toBeNull();
  });

  it('plays the shot up the box with a miss right drawn right (club frame, §4)', () => {
    const t = shotThumbnail(
      { start: at(200), end: at(345, 20), aim: at(360), ellipse: null },
      HOLE,
      PIN,
      BOX,
    )!;
    expect(t.end!.y).toBeLessThan(t.start.y);
    expect(t.aim!.y).toBeLessThan(t.end!.y);
    expect(Math.abs(t.aim!.x - t.start.x)).toBeLessThan(0.5);
    expect(t.end!.x).toBeGreaterThan(t.start.x);
    // Fitted inside the padded box.
    for (const p of [t.start, t.end!, t.aim!]) {
      expect(p.x).toBeGreaterThanOrEqual(BOX.padding - 0.1);
      expect(p.x).toBeLessThanOrEqual(BOX.width - BOX.padding + 0.1);
      expect(p.y).toBeGreaterThanOrEqual(BOX.padding - 0.1);
      expect(p.y).toBeLessThanOrEqual(BOX.height - BOX.padding + 0.1);
    }
  });

  it('keeps the frame when the hole plays in any direction', () => {
    // A shot due east, aimed due east: still drawn straight up.
    const start = TEE;
    const aim = at(0, 150);
    const t = shotThumbnail({ start, end: aim, aim, ellipse: null }, null, null, BOX)!;
    expect(Math.abs(t.end!.x - t.start.x)).toBeLessThan(0.5);
    expect(t.end!.y).toBeLessThan(t.start.y);
    expect(t.shapes).toEqual([]);
    expect(t.pin).toBeNull();
  });

  it('draws the green, fairway, bunker and water in view, background first', () => {
    const start = at(220);
    const t = shotThumbnail({ start, end: at(362), aim: PIN, ellipse: null }, HOLE, PIN, BOX)!;
    const kinds = t.shapes.map((s) => s.kind);
    expect(kinds).toContain('green');
    expect(kinds).toContain('bunker');
    expect(kinds).toContain('fairway');
    expect(kinds.indexOf('fairway')).toBeLessThan(kinds.indexOf('green'));
    expect(t.pin).not.toBeNull();
    expect(t.shapes[0]!.points).toMatch(/^-?[\d.]+,-?[\d.]+( -?[\d.]+,-?[\d.]+)+$/);
  });

  it('drops shapes that are out of view and keeps one that covers the box', () => {
    // A 20 m chip in the middle of the fairway: the green is off-screen, the fairway covers all.
    const t = shotThumbnail(
      { start: at(260), end: at(270), aim: at(275), ellipse: null },
      HOLE,
      PIN,
      { ...BOX, minSpanM: 20 },
    )!;
    expect(t.shapes.map((s) => s.kind)).toEqual(['fairway']);
  });

  it('includes the ellipse and never zooms beyond the minimum span', () => {
    const start = at(210);
    const aim = PIN;
    const ellipse = shotEllipse(start, aim, pattern);
    const t = shotThumbnail({ start, end: at(350), aim, ellipse }, HOLE, PIN, BOX)!;
    expect(t.ellipse!.split(' ').length).toBe(ellipse.length);
    const chip = shotThumbnail(
      { start: at(360), end: at(362), aim: PIN, ellipse: null },
      null,
      PIN,
      {
        ...BOX,
        minSpanM: 40,
      },
    )!;
    expect(chip.scale).toBeCloseTo((BOX.height - 2 * BOX.padding) / 40, 6);
  });
});

describe('worstShotFrames', () => {
  const shot = (p: Partial<Shot> & { seq: number }): Shot =>
    newShot({ id: `s${String(p.seq)}`, userId: 'u', roundId: 'r1', holeNumber: 1, ...p });
  const s1 = shot({ seq: 1, clubId: 'dr', lie: 'tee', start: TEE, end: at(230), target: at(240) });
  const s2 = shot({ seq: 2, clubId: '7i', lie: 'fairway', start: at(230), end: at(372) });

  it('finds each worst shot’s replay frame and the pin (override first)', () => {
    const review = {
      holes: [{ number: 1, shots: [{ shot: s1 }, { shot: s2 }] }],
      mostExpensive: [
        { shot: { shotId: 's1', holeNumber: 1 }, cost: 0.6 },
        { shot: { shotId: 'gone', holeNumber: 9 }, cost: 0.2 },
      ],
      clubLabels: { dr: 'Driver' },
      round: { pinOverrides: {} },
    } as unknown as RoundReview;
    const [a, b] = worstShotFrames(review, new Map([['dr', pattern]]), [HOLE]);
    expect(a!.frame?.id).toBe('s1');
    expect(a!.frame?.aim).toEqual(at(240));
    expect(a!.frame?.ellipse?.length).toBeGreaterThan(2);
    expect(a!.pin).toEqual(PIN);
    expect(b).toEqual({ shotId: 'gone', holeNumber: 9, frame: null, pin: null });

    const moved = at(365, 5);
    const withPin = {
      ...review,
      round: { pinOverrides: { '1': moved } },
    } as unknown as RoundReview;
    expect(worstShotFrames(withPin, new Map(), [HOLE])[0]!.pin).toEqual(moved);
  });
});
