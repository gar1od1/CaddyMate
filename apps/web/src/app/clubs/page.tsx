import { redirect } from 'next/navigation';
import { listClubPatterns, listClubs, type Db } from '@caddymate/api';
import { createClient } from '@/lib/supabase/server';
import { metresToYards } from '@caddymate/engine';
import { fmtDate, yds } from '@/lib/review/format';
import { ButtonLink } from '@/components/primitives/Button';
import { Card } from '@/components/primitives/Card';
import {
  FilterableTable,
  type FilterableColumn,
  type FilterableRow,
} from '@/components/primitives/FilterableTable';
import { Page, PageHeader } from '@/components/primitives/Page';
import { RefitButton } from './refit-button';

export const metadata = { title: 'Clubs · CaddyMate' };

export default async function ClubsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/sign-in');
  const db = supabase as unknown as Db;

  const [clubs, patterns, shotRows] = await Promise.all([
    listClubs(db),
    listClubPatterns(db),
    db
      .from('shots')
      .select('club_id, source')
      .not('club_id', 'is', null)
      .then((r) => r.data ?? []),
  ]);
  const byClub = new Map(patterns.map((p) => [p.clubId, p]));
  const counts = new Map<string, { sim: number; course: number }>();
  for (const s of shotRows) {
    const c = counts.get(s.club_id!) ?? { sim: 0, course: 0 };
    if (s.source === 'sim') c.sim++;
    else c.course++;
    counts.set(s.club_id!, c);
  }

  const columns: FilterableColumn[] = [
    { key: 'club', label: 'Club' },
    { key: 'mean', label: 'Mean yds', filter: 'number', align: 'right' },
    { key: 'bias', label: 'Bias yds', filter: 'number', align: 'right', title: 'Negative is left' },
    { key: 'sim', label: 'Sim shots', filter: 'number', align: 'right' },
    { key: 'course', label: 'Course shots', filter: 'number', align: 'right' },
    { key: 'neff', label: 'n eff.', filter: 'number', align: 'right' },
    { key: 'confidence', label: 'Confidence' },
    { key: 'fitted', label: 'Fitted', filter: 'date' },
  ];
  const rows: FilterableRow[] = clubs.map((c) => {
    const p = byClub.get(c.id);
    const n = counts.get(c.id) ?? { sim: 0, course: 0 };
    const bias = p?.params.lateral.mean ?? null;
    const mean = p?.params.distance.mean ?? null;
    return {
      key: c.id,
      tone: c.active ? undefined : 'muted',
      cells: {
        club: { text: c.name, href: c.kind === 'putter' ? undefined : `/clubs/${c.id}` },
        mean: { text: yds(mean), sortValue: mean === null ? null : metresToYards(mean) },
        bias: {
          text:
            bias === null ? '—' : `${yds(Math.abs(bias))} ${bias < 0 ? 'L' : bias > 0 ? 'R' : ''}`,
          // Signed yards, so "at most -2" finds the clubs that miss left.
          sortValue: bias === null ? null : metresToYards(bias),
        },
        sim: { text: String(n.sim), sortValue: n.sim },
        course: { text: String(n.course), sortValue: n.course },
        neff: { text: p ? p.nEffective.toFixed(1) : '—', sortValue: p?.nEffective ?? null },
        confidence: { text: p?.confidence ?? (c.kind === 'putter' ? '—' : 'no pattern') },
        fitted: {
          text: p ? fmtDate(p.fittedAt) : '—',
          sortValue: p?.fittedAt ?? null,
          tone: 'muted',
        },
      },
    };
  });

  return (
    <Page>
      <PageHeader
        title="Club dispersion"
        actions={
          <>
            <ButtonLink href="/import" variant="secondary">
              Import sim session
            </ButtonLink>
            <RefitButton label="Refit all" />
          </>
        }
      />
      <Card>
        <FilterableTable
          label="Clubs"
          columns={columns}
          rows={rows}
          emptyMessage="No clubs yet. Set up your bag in the app."
        />
      </Card>
    </Page>
  );
}
