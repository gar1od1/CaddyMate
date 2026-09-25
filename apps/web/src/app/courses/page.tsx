import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { listCourses, type Db } from '@/lib/courses/repo';

export const metadata = { title: 'Courses · CaddyMate' };

export default async function CoursesPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/sign-in');

  const courses = await listCourses(supabase as unknown as Db);
  const mine = courses.filter((c) => c.created_by_user_id === user.id);
  const others = courses.filter((c) => c.created_by_user_id !== user.id);

  return (
    <main className="mx-auto w-full max-w-3xl space-y-6 p-6">
      <header className="flex items-center justify-between gap-4">
        <div>
          <Link href="/" className="link text-sm">
            ← Home
          </Link>
          <h1 className="text-2xl font-bold">Courses</h1>
        </div>
        <Link href="/courses/new" className="btn px-4 py-2">
          New course
        </Link>
      </header>

      <section className="card space-y-3">
        <h2 className="font-semibold">My courses</h2>
        {mine.length === 0 ? (
          <p className="text-muted text-sm">
            None yet. Create one by hand or import it from OpenStreetMap.
          </p>
        ) : (
          <CourseList courses={mine} editable />
        )}
      </section>

      <section className="card space-y-3">
        <h2 className="font-semibold">Published</h2>
        {others.length === 0 ? (
          <p className="text-muted text-sm">No published courses from other players yet.</p>
        ) : (
          <CourseList courses={others} />
        )}
      </section>
    </main>
  );
}

function CourseList({
  courses,
  editable = false,
}: {
  courses: Awaited<ReturnType<typeof listCourses>>;
  editable?: boolean;
}) {
  return (
    <ul className="divide-y divide-border">
      {courses.map((c) => (
        <li key={c.course_id} className="flex items-center gap-3 py-3">
          <div className="min-w-0 flex-1">
            <Link
              href={editable ? `/courses/${c.course_id}/edit` : `/courses/${c.course_id}`}
              className="font-semibold hover:underline"
            >
              {c.name}
            </Link>
            <p className="text-muted text-sm">
              {c.country} · {c.source === 'osm' ? 'OpenStreetMap import' : c.source}
              {c.current_version > 0 ? ` · v${c.current_version}` : ''}
            </p>
          </div>
          <span
            className={`rounded-full px-2 py-0.5 text-xs ${
              c.status === 'published'
                ? 'bg-accent text-accent-text'
                : 'border border-border text-muted'
            }`}
          >
            {c.status}
          </span>
          {editable ? (
            <Link href={`/courses/${c.course_id}/edit`} className="link text-sm">
              Edit
            </Link>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
