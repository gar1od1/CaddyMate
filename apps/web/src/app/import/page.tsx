import { redirect } from 'next/navigation';
import { listClubs, type Db } from '@caddymate/api';
import { createClient } from '@/lib/supabase/server';
import { SimImport } from '@/components/import/sim-import';
import { fmtDate } from '@/lib/review/format';
import { ButtonLink } from '@/components/primitives/Button';
import { Card } from '@/components/primitives/Card';
import {
  FilterableTable,
  type FilterableColumn,
  type FilterableRow,
} from '@/components/primitives/FilterableTable';
import { Page, PageHeader } from '@/components/primitives/Page';

export const metadata = { title: 'Simulator import · CaddyMate' };

export default async function ImportPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/sign-in');
  const db = supabase as unknown as Db;

  const [clubs, sessionsRes] = await Promise.all([
    listClubs(db),
    db
      .from('sim_sessions')
      .select('session_id, imported_at, source, row_count, notes')
      .order('imported_at', { ascending: false })
      .limit(25),
  ]);
  const sessions = sessionsRes.data ?? [];

  const columns: FilterableColumn[] = [
    { key: 'imported', label: 'Imported', filter: 'date' },
    { key: 'source', label: 'Source' },
    { key: 'rows', label: 'Rows', filter: 'number', align: 'right' },
    { key: 'notes', label: 'Notes', filter: 'text' },
  ];
  const rows: FilterableRow[] = sessions.map((s) => ({
    key: s.session_id,
    cells: {
      imported: { text: fmtDate(s.imported_at), sortValue: s.imported_at },
      source: { text: s.source === 'gspro' ? 'GSPro' : 'Square Golf' },
      rows: { text: String(s.row_count), sortValue: s.row_count },
      notes: { text: s.notes || '—', tone: 'muted' },
    },
  }));

  return (
    <Page width="narrow">
      <PageHeader
        title="Simulator import"
        description="Sim shots feed your neutral dispersion patterns. The preview below is parsed in your browser; the server re-reads the file, skips duplicates and refits the clubs."
        actions={
          <ButtonLink href="/clubs" variant="secondary">
            Club dispersion
          </ButtonLink>
        }
      />

      <SimImport
        clubs={clubs.map((c) => ({
          id: c.id,
          name: c.name,
          kind: c.kind,
          loftDeg: c.loftDeg,
          simNameAliases: c.simNameAliases,
        }))}
      />

      <Card title="Past sessions">
        {sessionsRes.error ? (
          <p className="text-danger text-sm" role="alert">
            Could not load sessions: {sessionsRes.error.message}
          </p>
        ) : (
          <FilterableTable
            label="Past sessions"
            columns={columns}
            rows={rows}
            emptyMessage="No sessions imported yet."
          />
        )}
      </Card>
    </Page>
  );
}
