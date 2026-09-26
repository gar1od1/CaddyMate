import {
  DEFAULT_CONDITION_MODEL,
  FLAT_STANCE,
  STANDARD_CONDITIONS,
  resolveConditionModel,
  fitPattern,
  haversineDistanceM,
  priorFor,
  recommend,
  toRecommendationSnapshot,
  type ClubPattern,
} from '@caddymate/engine';
import { describe, expect, it } from 'vitest';
import { at, BAG, HOLE, PIN, TEE } from '@/test/fixtures';
import {
  RecommendationCache,
  baselineFor,
  buildRecommendInput,
  conditionModelKey,
  describeChoice,
  describeOption,
  evaluateCardChoice,
  holeGeometry,
  matchingOption,
  recommendationKey,
  strategyClubs,
  type PositionInput,
} from './recommendation';

const NONE = new Map<string, ClubPattern>();

const position = (over: Partial<PositionInput> = {}): PositionInput => ({
  start: at(230),
  startLie: 'fairway',
  pin: PIN,
  hole: HOLE,
  conditions: STANDARD_CONDITIONS,
  slope: FLAT_STANCE,
  handedness: 'R',
  bag: strategyClubs(BAG, NONE, 13),
  handicapIndex: 13,
  isTeeShot: false,
  ...over,
});

describe('recommendation input assembly', () => {
  it('maps the bundle hole to strategy geometry (polygons, tree points, line of play)', () => {
    const g = holeGeometry(HOLE, PIN)!;
    expect(g.pin).toEqual(PIN);
    expect(g.features.map((f) => f.kind)).toEqual(['fairway', 'bunker', 'water', 'tree']);
    expect(g.features[3]).toMatchObject({ point: at(200, -30), radiusM: 5 });
    expect(g.features[2]!.penalty).toBe('yellow');
    expect(g.lineOfPlay).toHaveLength(3);
    expect(holeGeometry({ ...HOLE, green: null }, PIN)).toBeNull();
  });

  it('builds the bag from stored patterns or the seeded prior, without the putter', () => {
    const stored: ClubPattern = fitPattern([], {
      prior: priorFor({ kind: 'iron', stockTotalM: 160 }),
    });
    const bag = strategyClubs(BAG, new Map([['7i', stored]]), 13);
    expect(bag.map((c) => c.id)).toEqual(['dr', '5w', '6i', '7i', '9i', 'pw']);
    expect(bag.find((c) => c.id === '7i')!.pattern).toBe(stored);
    expect(bag.find((c) => c.id === '6i')!.pattern.distance.mean).toBe(155);
    expect(bag.find((c) => c.id === '6i')!.pattern.confidence).toBe('seeded');
    expect(bag.find((c) => c.id === '6i')).toMatchObject({ label: '6i', loftDeg: 26.5 });
    expect(strategyClubs([{ ...BAG[0]!, active: false }], NONE, null)).toEqual([]);
  });

  it('uses the handicap baseline (persona 13 → hcp15) and refuses the green', () => {
    expect(baselineFor(null)).toBe('hcp15');
    expect(baselineFor(4)).toBe('scratch');
    const input = buildRecommendInput(position())!;
    expect(input.baseline).toBe('hcp15');
    expect(input.clubs).toHaveLength(6);
    expect(input.hole.geometry.green.outer.length).toBeGreaterThan(3);
    expect(buildRecommendInput(position({ startLie: 'green' }))).toBeNull();
    expect(buildRecommendInput(position({ bag: [] }))).toBeNull();
  });

  it('keys positions: equal inputs share a key, a moved ball or new wind does not', () => {
    const k = recommendationKey(position());
    expect(recommendationKey(position())).toBe(k);
    // Sub-metre GPS noise rounds away; 5 m does not.
    expect(recommendationKey(position({ start: at(230, 0.3) }))).toBe(k);
    expect(recommendationKey(position({ start: at(225) }))).not.toBe(k);
    expect(
      recommendationKey(position({ conditions: { ...STANDARD_CONDITIONS, windSpeedMps: 6 } })),
    ).not.toBe(k);
    expect(recommendationKey(position({ slope: { ...FLAT_STANCE, uphill: 'mild' } }))).not.toBe(k);
  });

  it('passes the player condition model to the search and keys on it (decision 007)', () => {
    const learned = resolveConditionModel({ wind: { headPerMps: 0.03 } });
    expect(buildRecommendInput(position())!.model).toBeUndefined();
    expect(buildRecommendInput(position({ model: learned }))!.model).toBe(learned);

    const k = recommendationKey(position());
    // The default model, however it was resolved, keys like no model.
    expect(recommendationKey(position({ model: DEFAULT_CONDITION_MODEL }))).toBe(k);
    expect(recommendationKey(position({ model: resolveConditionModel({}) }))).toBe(k);
    const kl = recommendationKey(position({ model: learned }));
    expect(kl).not.toBe(k);
    // Equal models share a key; a different learned model does not.
    expect(conditionModelKey(resolveConditionModel({ wind: { headPerMps: 0.03 } }))).toBe(
      conditionModelKey(learned),
    );
    expect(conditionModelKey(learned)).toMatch(/^m[0-9a-z]+$/);
    expect(
      recommendationKey(position({ model: resolveConditionModel({ wind: { headPerMps: 0.04 } }) })),
    ).not.toBe(kl);
  });

  it('evaluates options with the player condition model', () => {
    const wind = { ...STANDARD_CONDITIONS, windSpeedMps: 6, windFromDeg: 0 };
    const base = buildRecommendInput(position({ conditions: wind }))!;
    const strong = buildRecommendInput(
      position({
        conditions: wind,
        model: resolveConditionModel({ wind: { headPerMps: 0.06, tailPerMps: 0.06 } }),
      }),
    )!;
    const aim = PIN;
    const a = evaluateCardChoice(base, null, '7i', aim)!;
    const b = evaluateCardChoice(strong, null, '7i', aim)!;
    expect(b.expectedStrokes).not.toBe(a.expectedStrokes);
  });
});

describe('recommendation outputs', () => {
  const input = buildRecommendInput(position())!;
  const rec = recommend(input);

  it('recommends an approach club with a one-line explanation', () => {
    const top = rec.options[0]!;
    expect(top.kind).toBe('approach');
    expect(['7i', '6i', '9i']).toContain(top.clubId);
    expect(describeOption(top, rec)).toMatch(/^\S+ — aim .*\d+ % green.*\.$/);
  });

  it('reuses a ranked option for the same (club, aim), else evaluates the choice', () => {
    const top = rec.options[0]!;
    expect(matchingOption(rec, top.clubId, top.aim)).toBe(top);
    expect(evaluateCardChoice(input, rec, top.clubId, top.aim)).toBe(top);
    const other = evaluateCardChoice(input, rec, 'pw', PIN)!;
    expect(other.clubId).toBe('pw');
    expect(other.expectedStrokes).toBeGreaterThanOrEqual(top.expectedStrokes - 0.05);
    expect(evaluateCardChoice(input, rec, 'pt', PIN)).toBeNull();
    expect(describeChoice(other, top)).toMatch(/^PW: \d+ % green/);
    expect(describeChoice(top, top)).toContain('as good as the best option');
  });

  it('snapshots the ranked list and the chosen option without ellipses', () => {
    const chosen = evaluateCardChoice(input, rec, 'pw', PIN)!;
    const snap = toRecommendationSnapshot(rec, chosen);
    expect(snap.chosen?.clubId).toBe('pw');
    expect(snap.options.length).toBe(rec.options.length);
    expect('ellipse80' in snap.options[0]!).toBe(false);
    expect(JSON.parse(JSON.stringify(snap))).toEqual(snap);
  });

  it('compares clubs off the tee', () => {
    const tee = recommend(
      buildRecommendInput(position({ start: TEE, startLie: 'tee', isTeeShot: true }))!,
    );
    expect(tee.options.length).toBeGreaterThan(1);
    expect(haversineDistanceM(TEE, tee.options[0]!.aim)).toBeGreaterThan(150);
  });
});

describe('RecommendationCache', () => {
  it('evicts the least recently used entry', () => {
    const c = new RecommendationCache(2);
    const r = {} as never;
    c.set('a', r);
    c.set('b', r);
    c.get('a');
    c.set('c', r);
    expect(c.get('b')).toBeUndefined();
    expect(c.get('a')).toBe(r);
    expect(c.size).toBe(2);
  });
});
