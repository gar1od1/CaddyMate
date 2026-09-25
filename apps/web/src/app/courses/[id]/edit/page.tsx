import { notFound, redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { ensureDraft, getCourse, type Db } from '@/lib/courses/repo';
import { CourseEditor } from '@/components/course-editor/course-editor';

export const metadata = { title: 'Course editor · CaddyMate' };

export default async function EditCoursePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/sign-in');
  const db = supabase as unknown as Db;

  // Visible but not ours: show the published version instead.
  const { data: row } = await db
    .from('courses')
    .select('course_id, created_by_user_id')
    .eq('course_id', id)
    .maybeSingle();
  if (!row) notFound();
  if (row.created_by_user_id !== user.id) redirect(`/courses/${id}`);

  await ensureDraft(db, id);
  const course = await getCourse(db, id);
  if (!course) notFound();
  return <CourseEditor key={course.course.updated_at} initial={course} />;
}
