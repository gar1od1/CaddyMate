import Link from 'next/link';
import { redirect } from 'next/navigation';
import { listClubPatterns, listClubs, type Db } from '@caddymate/api';
import { createClient } from '@/lib/supabase/server';
import { fmtDate, yds } from '@/lib/review/format';
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

  return (
    <main className="mx-auto w-full max-w-4xl space-y-6 p-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Link href="/" className="link text-sm">
            ← Home
          </Link>
          <h1 className="text-2xl font-bold">Club dispersion</h1>
        </div>
        <div className="flex items-center gap-4">
          <Link href="/import" className="link text-sm">
            Import sim session
          </Link>
          <RefitButton label="Refit all" />
        </div>
      </header>
      <section className="card overflow-x-auto p-0">
        {clubs.length === 0 ? (
          <p className="text-muted p-6 text-sm">No clubs yet. Set up your bag in the app.</p>
        ) : (
          <table className="w-full text-sm" style={{ fontVariantNumeric: 'tabular-nums' }}>
            <thead className="text-muted text-left text-xs uppercase">
              <tr className="border-b border-border">
                <th className="px-4 py-3 font-medium">Club</th>
                <th className="px-4 py-3 text-right font-medium">Mean yds</th>
                <th className="px-4 py-3 text-right font-medium">Bias yds</th>
                <th className="px-4 py-3 text-right font-medium">Shots (sim / course)</th>
                <th className="px-4 py-3 text-right font-medium">n eff.</th>
                <th className="px-4 py-3 font-medium">Confidence</th>
                <th className="px-4 py-3 font-medium">Fitted</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {clubs.map((c) => {
                const p = byClub.get(c.id);
                const n = counts.get(c.id) ?? { sim: 0, course: 0 };
                const bias = p?.params.lateral.mean ?? null;
                return (
                  <tr key={c.id} className={c.active ? '' : 'text-muted'}>
                    <td className="px-4 py-3">
                      {c.kind === 'putter' ? (
                        c.name
                      ) : (
                        <Link href={`/clubs/${c.id}`} className="font-semibold hover:underline">
                          {c.name}
                        </Link>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">{yds(p?.params.distance.mean ?? null)}</td>
                    <td className="px-4 py-3 text-right">
                      {bias === null
                        ? '—'
                        : `${yds(Math.abs(bias))} ${bias < 0 ? 'L' : bias > 0 ? 'R' : ''}`}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {n.sim} / {n.course}
                    </td>
                    <td className="px-4 py-3 text-right">{p ? p.nEffective.toFixed(1) : '—'}</td>
                    <td className="px-4 py-3">
                      {p?.confidence ?? (c.kind === 'putter' ? '—' : 'no pattern')}
                    </td>
                    <td className="text-muted px-4 py-3">{p ? fmtDate(p.fittedAt) : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>
    </main>
  );
}
