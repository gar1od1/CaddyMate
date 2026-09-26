import { Page, PageHeader } from '@/components/primitives/Page';
import { NewCourseForm } from './new-course-form';

export const metadata = { title: 'New course · CaddyMate' };

export default function NewCoursePage() {
  return (
    <Page width="wide">
      <PageHeader title="New course" />
      <NewCourseForm />
    </Page>
  );
}
