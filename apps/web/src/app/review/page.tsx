import { redirect } from 'next/navigation';
import type { Db } from '@caddymate/api';
import { createClient } from '@/lib/supabase/server';
import { listRoundRows, selectInChunks } from '@/lib/review/data';
import { fmtDate, sgText } from '@/lib/review/format';
import { Card } from '@/components/primitives/Card';
import {
  FilterableTable,
  type FilterableColumn,
  type FilterableRow,
} from '@/components/primitives/FilterableTable';
import { Page, PageHeader } from '@/components/primitives/Page';

export const metadata = { title: 'Rounds · CaddyMate' };

export default async function ReviewPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/sign-in');
  const db = supabase as unknown as Db;

  const rounds = await listRoundRows(db);
  const ids = rounds.map((r) => r.round_id);
  const [sgRows, holeRows] = await Promise.all([
    selectInChunks(ids, (c) =>
      db.from('shots').select('round_id, sg').in('round_id', c).not('sg', 'is', null),
    ),
    selectInChunks(ids, (c) =>
      db.from('hole_scores').select('round_id, net_strokes').in('round_id', c),
    ),
  ]);
  const sgByRound = new Map<string, number>();
  for (const s of sgRows)
    sgByRound.set(s.round_id!, (sgByRound.get(s.round_id!) ?? 0) + Number(s.sg));
  const netByRound = new Map<string, number | null>();
  for (const h of holeRows) {
    const prev = netByRound.get(h.round_id);
    netByRound.set(
      h.round_id,
      prev === null || h.net_strokes === null ? null : (prev ?? 0) + h.net_strokes,
    );
  }

  const columns: FilterableColumn[] = [
    { key: 'date', label: 'Date', filter: 'date', phone: 'title' },
    { key: 'course', label: 'Course' },
    { key: 'gross', label: 'Gross', filter: 'number', align: 'right' },
    { key: 'net', label: 'Net', filter: 'number', align: 'right' },
    { key: 'points', label: 'Points', filter: 'number', align: 'right' },
    { key: 'sg', label: 'SG total', filter: 'number', align: 'right' },
    { key: 'status', label: 'Status' },
  ];
  const rows: FilterableRow[] = rounds.map((r) => {
    const sg = sgByRound.get(r.round_id);
    const net = netByRound.get(r.round_id) ?? null;
    return {
      key: r.round_id,
      cells: {
        date: {
          text: fmtDate(r.started_at),
          href: `/review/${r.round_id}`,
          sortValue: r.started_at,
        },
        course: { text: r.courses?.name ?? '—' },
        gross: { text: r.gross === null ? '—' : String(r.gross), sortValue: r.gross },
        net: { text: net === null ? '—' : String(net), sortValue: net },
        points: {
          text: r.stableford === null ? '—' : String(r.stableford),
          sortValue: r.stableford,
        },
        sg:
          sg === undefined
            ? { text: 'not graded', tone: 'muted' }
            : { text: sgText(sg), sortValue: sg },
        status: { text: r.status, tone: 'muted' },
      },
    };
  });

  return (
    <Page>
      <PageHeader title="Rounds" description="Every round you have played, newest first." />
      <Card>
        <FilterableTable
          label="Rounds"
          columns={columns}
          rows={rows}
          phoneLayout="cards"
          emptyMessage="No rounds yet. Play one in the app."
        />
      </Card>
    </Page>
  );
}
