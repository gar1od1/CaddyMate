import { resolveConditionModel, type ConditionModelV1 } from '@caddymate/engine';
import type { Db } from './client.js';
import { must, mustMaybe, num } from './errors.js';
import type { Profile, Row } from './types.js';

export function profileFromRow(r: Row<'profiles'>): Profile {
  return {
    userId: r.user_id,
    displayName: r.display_name,
    handedness: r.handedness,
    units: r.units,
    handicapIndexOfficial: num(r.handicap_index_official),
    defaultShape: r.default_shape,
    homeCourseId: r.home_course_id,
    // Untrusted JSON: only an object is kept; `resolveConditionModel` sanitises its leaves.
    conditionOverrides: isPlainObject(r.condition_overrides) ? r.condition_overrides : {},
  };
}

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * The player's condition model: the engine defaults with the learned
 * `profiles.condition_overrides` merged on top (decision 007). Resolve once per
 * profile and pass it as `model` wherever conditions are applied or stripped
 * (neutral results, the dispersion overlay, plays-like, strategy), so the
 * device matches the server's `refit`. No profile, or one cached before the
 * field existed → the defaults. `resolveConditionModel` ignores unknown keys
 * and non-finite numbers, so stored JSON is safe to pass straight in.
 */
export function playerConditionModel(
  profile: Pick<Profile, 'conditionOverrides'> | null | undefined,
): ConditionModelV1 {
  return resolveConditionModel(profile?.conditionOverrides ?? null);
}

export async function getProfile(db: Db, userId: string): Promise<Profile | null> {
  const data = mustMaybe(
    await db.from('profiles').select('*').eq('user_id', userId).maybeSingle(),
    'getProfile',
  );
  return data ? profileFromRow(data) : null;
}

/** Editable fields; `conditionOverrides` is written by the server's refit only. */
export type ProfilePatch = Partial<Omit<Profile, 'userId' | 'conditionOverrides'>>;

export async function updateProfile(db: Db, userId: string, patch: ProfilePatch): Promise<Profile> {
  const row: Partial<Row<'profiles'>> = {};
  if (patch.displayName !== undefined) row.display_name = patch.displayName;
  if (patch.handedness !== undefined) row.handedness = patch.handedness;
  if (patch.units !== undefined) row.units = patch.units;
  if (patch.handicapIndexOfficial !== undefined)
    row.handicap_index_official = patch.handicapIndexOfficial;
  if (patch.defaultShape !== undefined) row.default_shape = patch.defaultShape;
  if (patch.homeCourseId !== undefined) row.home_course_id = patch.homeCourseId;
  const data = must(
    await db.from('profiles').update(row).eq('user_id', userId).select('*').single(),
    'updateProfile',
  );
  return profileFromRow(data);
}
