import { DEFAULT_CONDITION_MODEL } from '@caddymate/engine';
import { describe, expect, it } from 'vitest';
import { playerConditionModel, profileFromRow } from './profiles.js';
import type { Row } from './types.js';

const row = (overrides: unknown): Row<'profiles'> =>
  ({
    user_id: 'u',
    display_name: null,
    handedness: 'R',
    units: 'yards',
    handicap_index_official: null,
    default_shape: 'straight',
    home_course_id: null,
    condition_overrides: overrides,
  }) as unknown as Row<'profiles'>;

describe('profileFromRow — condition overrides', () => {
  it('keeps a stored object and maps anything else to {}', () => {
    const learned = { wind: { headPerMps: 0.03 } };
    expect(profileFromRow(row(learned)).conditionOverrides).toEqual(learned);
    for (const junk of [null, 'x', 3, [1, 2]]) {
      expect(profileFromRow(row(junk)).conditionOverrides).toEqual({});
    }
  });
});

describe('playerConditionModel', () => {
  it('is the engine default without overrides', () => {
    expect(playerConditionModel(null)).toEqual(DEFAULT_CONDITION_MODEL);
    expect(playerConditionModel(profileFromRow(row({})))).toEqual(DEFAULT_CONDITION_MODEL);
    // A profile cached on a device before the field existed.
    expect(playerConditionModel({})).toEqual(DEFAULT_CONDITION_MODEL);
  });

  it('merges learned coefficients, ignoring unknown keys and non-finite values', () => {
    const m = playerConditionModel(
      profileFromRow(
        row({
          wind: { headPerMps: 0.03, tailPerMps: 'x' },
          elevation: { perMetre: { iron: 0.8 } },
          bogus: 1,
          version: 99,
        }),
      ),
    );
    expect(m.wind.headPerMps).toBe(0.03);
    expect(m.wind.tailPerMps).toBe(DEFAULT_CONDITION_MODEL.wind.tailPerMps);
    expect(m.elevation.perMetre.iron).toBe(0.8);
    expect(m.elevation.perMetre.wedge).toBe(DEFAULT_CONDITION_MODEL.elevation.perMetre.wedge);
    expect(m.version).toBe(DEFAULT_CONDITION_MODEL.version);
    expect('bogus' in m).toBe(false);
  });
});
