import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { listCourses, type Db } from '@/lib/courses/repo';
import { fmtDate } from '@/lib/review/format';
import { ButtonLink } from '@/components/primitives/Button';
import { Card } from '@/components/primitives/Card';
import {
  FilterableTable,
  type FilterableColumn,
  type FilterableRow,
} from '@/components/primitives/FilterableTable';
import { Page, PageHeader } from '@/components/primitives/Page';

export const metadata = { title: 'Courses · CaddyMate' };

const COLUMNS: FilterableColumn[] = [
  { key: 'name', label: 'Course', filter: 'text', phone: 'title' },
  { key: 'whose', label: 'Whose' },
  { key: 'country', label: 'Country' },
  { key: 'source', label: 'Source' },
  { key: 'version', label: 'Version', filter: 'number', align: 'right' },
  { key: 'status', label: 'Status' },
  { key: 'updated', label: 'Updated', filter: 'date', phone: 'hide' },
  { key: 'open', label: '', filter: false, sort: false, align: 'right', phone: 'actions' },
];

export default async function CoursesPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/sign-in');

  const courses = await listCourses(supabase as unknown as Db);
  // Mine first, then the published courses of other players; each by name.
  const ordered = [
    ...courses.filter((c) => c.created_by_user_id === user.id),
    ...courses.filter((c) => c.created_by_user_id !== user.id),
  ];
  const rows: FilterableRow[] = ordered.map((c) => {
    const mine = c.created_by_user_id === user.id;
    const href = mine ? `/courses/${c.course_id}/edit` : `/courses/${c.course_id}`;
    return {
      key: c.course_id,
      cells: {
        name: { text: c.name, href },
        whose: { text: mine ? 'Mine' : 'Published by others' },
        country: { text: c.country },
        source: { text: c.source === 'osm' ? 'OpenStreetMap import' : c.source },
        version: {
          text: c.current_version > 0 ? `v${String(c.current_version)}` : '—',
          sortValue: c.current_version > 0 ? c.current_version : null,
        },
        status: {
          text: c.status,
          node: (
            <span className={`pill ${c.status === 'published' ? 'pill-accent' : ''}`}>
              {c.status}
            </span>
          ),
        },
        updated: { text: fmtDate(c.updated_at), sortValue: c.updated_at, tone: 'muted' },
        open: {
          text: mine ? 'Edit' : 'View',
          node: (
            <Link href={href} className="link text-sm">
              {mine ? 'Edit' : 'View'}
            </Link>
          ),
        },
      },
    };
  });

  return (
    <Page>
      <PageHeader
        title="Courses"
        description="Yours to edit, and the courses other players have published."
        actions={<ButtonLink href="/courses/new">New course</ButtonLink>}
      />
      <Card>
        <FilterableTable
          label="Courses"
          columns={COLUMNS}
          rows={rows}
          phoneLayout="cards"
          emptyMessage="None yet. Create one by hand or import it from OpenStreetMap."
        />
      </Card>
    </Page>
  );
}
