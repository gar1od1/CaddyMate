import { notFound, redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getCourse, type Db } from '@/lib/courses/repo';
import { CourseEditor } from '@/components/course-editor/course-editor';
import { Page, PageHeader } from '@/components/primitives/Page';

export const metadata = { title: 'Course · CaddyMate' };

/** Read-only view of a course's current published version. */
export default async function CoursePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/sign-in');
  const db = supabase as unknown as Db;

  const { data: row } = await db
    .from('courses')
    .select('current_version, created_by_user_id')
    .eq('course_id', id)
    .maybeSingle();
  if (!row) notFound();
  if (row.current_version === 0) {
    if (row.created_by_user_id === user.id) redirect(`/courses/${id}/edit`);
    notFound();
  }
  const course = await getCourse(db, id, row.current_version);
  if (!course) notFound();
  if (course.holes.length === 0) {
    return (
      <Page width="narrow">
        <PageHeader title={course.course.name} />
        <p className="text-muted">This course has no holes yet.</p>
      </Page>
    );
  }
  return <CourseEditor initial={course} readOnly />;
}
