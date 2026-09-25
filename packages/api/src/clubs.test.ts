import { metresToYards } from '@caddymate/engine';
import { describe, expect, it } from 'vitest';
import { DEFAULT_BAG, defaultBag, interpolateStockYards } from './clubs.js';

describe('interpolateStockYards', () => {
  it('hits the anchors exactly', () => {
    expect(interpolateStockYards(9)).toBe(240);
    expect(interpolateStockYards(30.5)).toBe(160);
    expect(interpolateStockYards(44.5)).toBe(120);
  });

  it('decreases monotonically with loft, extrapolating past the ends', () => {
    let prev = Infinity;
    for (let loft = 5; loft <= 64; loft += 0.5) {
      const y = interpolateStockYards(loft);
      expect(y).toBeLessThan(prev);
      prev = y;
    }
    expect(interpolateStockYards(60)).toBeGreaterThan(60);
  });

  it('handles degenerate anchor lists', () => {
    expect(interpolateStockYards(20, [])).toBe(0);
    expect(interpolateStockYards(20, [[10, 200]])).toBe(200);
  });
});

describe('defaultBag', () => {
  it('matches the spec §2 bag with stated distances', () => {
    const bag = defaultBag();
    expect(bag.map((c) => c.name)).toEqual(DEFAULT_BAG.map((c) => c.name));
    expect(bag).toHaveLength(13);
    const yd = (name: string) => {
      const m = bag.find((c) => c.name === name)?.stockTotalM;
      return m == null ? null : Math.round(metresToYards(m));
    };
    expect(yd('Driver')).toBe(240);
    expect(yd('7i')).toBe(160);
    expect(yd('PW')).toBe(120);
    expect(yd('Putter')).toBeNull();
    expect(bag.map((c) => c.bagOrder)).toEqual(bag.map((_, i) => i));
  });
});
