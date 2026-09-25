import Link from 'next/link';
import { NewCourseForm } from './new-course-form';

export const metadata = { title: 'New course · CaddyMate' };

export default function NewCoursePage() {
  return (
    <main className="mx-auto w-full max-w-4xl space-y-6 p-6">
      <header>
        <Link href="/courses" className="link text-sm">
          ← Courses
        </Link>
        <h1 className="text-2xl font-bold">New course</h1>
      </header>
      <NewCourseForm />
    </main>
  );
}
