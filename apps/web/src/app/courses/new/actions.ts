'use server';

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { createCourse, type Db } from '@/lib/courses/repo';

export interface CreateState {
  error: string | null;
}

/** Create an empty draft course and open it in the editor. */
export async function createCourseAction(_prev: CreateState, form: FormData): Promise<CreateState> {
  const name = String(form.get('name') ?? '').trim();
  const country = String(form.get('country') ?? '')
    .trim()
    .toUpperCase();
  const lat = Number(form.get('lat'));
  const lng = Number(form.get('lng'));
  if (!name) return { error: 'Name is required.' };
  if (!/^[A-Z]{2}$/.test(country)) return { error: 'Country must be a 2-letter code (e.g. IE).' };
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    return { error: 'Pick the course centre on the map or enter a valid latitude/longitude.' };
  }

  let id: string;
  try {
    const supabase = await createClient();
    id = await createCourse(supabase as unknown as Db, { name, country, lat, lng });
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
  redirect(`/courses/${id}/edit`);
}
