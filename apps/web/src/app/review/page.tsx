import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { Db } from '@caddymate/api';
import { createClient } from '@/lib/supabase/server';
import { listRoundRows, selectInChunks } from '@/lib/review/data';
import { fmtDate, sgText } from '@/lib/review/format';

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

  return (
    <main className="mx-auto w-full max-w-4xl space-y-6 p-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Link href="/" className="link text-sm">
            ← Home
          </Link>
          <h1 className="text-2xl font-bold">Rounds</h1>
        </div>
        <nav className="flex gap-4 text-sm">
          <Link href="/review/trends" className="link">
            Trends &amp; handicap
          </Link>
          <Link href="/clubs" className="link">
            Club dispersion
          </Link>
        </nav>
      </header>

      <section className="card overflow-x-auto p-0">
        {rounds.length === 0 ? (
          <p className="text-muted p-6 text-sm">No rounds yet. Play one in the app.</p>
        ) : (
          <table className="w-full text-sm" style={{ fontVariantNumeric: 'tabular-nums' }}>
            <thead className="text-muted text-left text-xs uppercase">
              <tr className="border-b border-border">
                <th className="px-4 py-3 font-medium">Date</th>
                <th className="px-4 py-3 font-medium">Course</th>
                <th className="px-4 py-3 text-right font-medium">Gross</th>
                <th className="px-4 py-3 text-right font-medium">Net</th>
                <th className="px-4 py-3 text-right font-medium">Points</th>
                <th className="px-4 py-3 text-right font-medium">SG total</th>
                <th className="px-4 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rounds.map((r) => {
                const sg = sgByRound.get(r.round_id);
                const net = netByRound.get(r.round_id) ?? null;
                return (
                  <tr key={r.round_id} className="hover:bg-bg-elevated">
                    <td className="px-4 py-3">
                      <Link
                        href={`/review/${r.round_id}`}
                        className="font-semibold hover:underline"
                      >
                        {fmtDate(r.started_at)}
                      </Link>
                    </td>
                    <td className="px-4 py-3">{r.courses?.name ?? '—'}</td>
                    <td className="px-4 py-3 text-right">{r.gross ?? '—'}</td>
                    <td className="px-4 py-3 text-right">{net ?? '—'}</td>
                    <td className="px-4 py-3 text-right">{r.stableford ?? '—'}</td>
                    <td className="px-4 py-3 text-right">
                      {sg === undefined ? (
                        <span className="text-muted">not graded</span>
                      ) : (
                        sgText(sg)
                      )}
                    </td>
                    <td className="text-muted px-4 py-3">{r.status}</td>
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
