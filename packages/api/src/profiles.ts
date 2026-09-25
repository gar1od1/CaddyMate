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
  };
}

export async function getProfile(db: Db, userId: string): Promise<Profile | null> {
  const data = mustMaybe(
    await db.from('profiles').select('*').eq('user_id', userId).maybeSingle(),
    'getProfile',
  );
  return data ? profileFromRow(data) : null;
}

export type ProfilePatch = Partial<Omit<Profile, 'userId'>>;

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
