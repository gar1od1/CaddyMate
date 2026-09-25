import { describe, expect, it } from 'vitest';
import { gradeShot, roundGradingSummary, shotCost, type GradedShot } from './grading.js';

describe('gradeShot', () => {
  it('grades a good decision executed well', () => {
    const g = gradeShot({ eBest: 2.9, eChosen: 2.93, eActual: 2.5, eP20: 3.2 });
    expect(g.strategyLoss).toBeCloseTo(0.03, 9);
    expect(g.executionLoss).toBeCloseTo(0.43, 9);
    expect(g.decisionGrade).toBe('good');
    expect(g.executionGrade).toBe('good');
  });

  it('grades a poor decision executed poorly', () => {
    const g = gradeShot({ eBest: 2.9, eChosen: 3.1, eActual: 3.5, eP20: 3.3 });
    expect(g.strategyLoss).toBeCloseTo(0.2, 9);
    expect(g.executionLoss).toBeCloseTo(-0.4, 9);
    expect(g.decisionGrade).toBe('poor');
    expect(g.executionGrade).toBe('poor');
    expect(shotCost(g)).toBeCloseTo(0.6, 9);
  });

  it('handles boundaries', () => {
    const g = gradeShot({ eBest: 0, eChosen: 0.05, eActual: 1, eP20: 1 });
    expect(g.decisionGrade).toBe('good');
    expect(g.executionGrade).toBe('good');
    // Chosen beats the engine's "best" (e.g. player found a better aim): no loss.
    expect(gradeShot({ eBest: 3, eChosen: 2.8, eActual: 2.8, eP20: 3 }).strategyLoss).toBe(0);
    // Holed: E(actual) = 0.
    expect(gradeShot({ eBest: 1.2, eChosen: 1.2, eActual: 0, eP20: 1.5 }).executionLoss).toBe(1.2);
  });
});

describe('roundGradingSummary', () => {
  const shot = (
    shotId: string,
    eBest: number,
    eChosen: number,
    eActual: number,
    eP20: number,
    extra: Partial<GradedShot> = {},
  ): GradedShot => ({ shotId, ...gradeShot({ eBest, eChosen, eActual, eP20 }), ...extra });

  it('totals, 2×2 counts and most expensive shots', () => {
    const shots = [
      shot('a', 3, 3, 2.8, 3.3, { clubId: 'D', category: 'ott' }), // GG, cost −0.2
      shot('b', 3, 3.02, 3.6, 3.3, { clubId: 'D', category: 'ott' }), // GP, cost 0.6
      shot('c', 2.8, 3, 3, 3.2, { clubId: '7i', category: 'app' }), // PG, cost 0.2
      shot('d', 2.8, 3.1, 4.1, 3.4, { clubId: '7i', category: 'app' }), // PP, cost 1.3
      shot('e', 2.5, 2.6, 2.85, 2.9, { category: 'arg' }), // PG, cost 0.35
      shot('f', 1.8, 1.8, 1.9, 2, { clubId: null, category: null }), // GG, cost 0.1
      shot('g', 1.5, 1.5, 1.55, 2), // GG, cost 0.05
    ];
    const s = roundGradingSummary(shots);
    expect(s.matrix).toEqual({
      goodDecisionGoodExecution: 3,
      goodDecisionPoorExecution: 1,
      poorDecisionGoodExecution: 2,
      poorDecisionPoorExecution: 1,
    });
    expect(s.totals.count).toBe(7);
    expect(s.totals.strategyLoss).toBeCloseTo(0.62, 9);
    expect(s.totals.executionLoss).toBeCloseTo(-1.78, 9);
    expect(s.totals.cost).toBeCloseTo(s.totals.strategyLoss - s.totals.executionLoss, 9);
    expect(Object.keys(s.byClub).sort()).toEqual(['7i', 'D']);
    expect(s.byClub.D!.count).toBe(2);
    expect(s.byCategory.app!.cost).toBeCloseTo(1.5, 9);
    expect(s.byCategory.putt).toBeUndefined();
    expect(s.mostExpensive.map((x) => x.shot.shotId)).toEqual(['d', 'b', 'e', 'c', 'f']);
    expect(s.mostExpensive[0]!.cost).toBeCloseTo(1.3, 9);
    expect(s.mostExpensive[0]!.shot).toBe(shots[3]);
  });

  it('omits shots that cost nothing', () => {
    const s = roundGradingSummary([shot('a', 3, 3, 2.5, 3.3)]);
    expect(s.mostExpensive).toEqual([]);
    expect(roundGradingSummary([]).totals).toEqual({
      strategyLoss: 0,
      executionLoss: 0,
      cost: 0,
      count: 0,
    });
  });
});
