import Link from 'next/link';
import { redirect } from 'next/navigation';
import { listClubs, type Db } from '@caddymate/api';
import { createClient } from '@/lib/supabase/server';
import { SimImport } from '@/components/import/sim-import';
import { fmtDate } from '@/lib/review/format';

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

  return (
    <main className="mx-auto w-full max-w-3xl space-y-6 p-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Link href="/" className="link text-sm">
            ← Home
          </Link>
          <h1 className="text-2xl font-bold">Simulator import</h1>
          <p className="text-muted text-sm">
            Sim shots feed your neutral dispersion patterns. The preview below is parsed in your
            browser; the server re-reads the file, skips duplicates and refits the clubs.
          </p>
        </div>
        <Link href="/clubs" className="link text-sm">
          Club dispersion →
        </Link>
      </header>

      <SimImport
        clubs={clubs.map((c) => ({
          id: c.id,
          name: c.name,
          kind: c.kind,
          loftDeg: c.loftDeg,
          simNameAliases: c.simNameAliases,
        }))}
      />

      <section className="card space-y-3">
        <h2 className="text-lg font-semibold">Past sessions</h2>
        {sessionsRes.error ? (
          <p className="text-danger text-sm">
            Could not load sessions: {sessionsRes.error.message}
          </p>
        ) : sessions.length === 0 ? (
          <p className="text-muted text-sm">No sessions imported yet.</p>
        ) : (
          <table className="w-full text-sm" style={{ fontVariantNumeric: 'tabular-nums' }}>
            <thead className="text-muted text-xs uppercase">
              <tr className="border-b border-border">
                <th className="py-1.5 text-left font-medium">Imported</th>
                <th className="py-1.5 text-left font-medium">Source</th>
                <th className="py-1.5 text-right font-medium">Rows</th>
                <th className="py-1.5 pl-4 text-left font-medium">Notes</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {sessions.map((s) => (
                <tr key={s.session_id}>
                  <td className="py-1.5">{fmtDate(s.imported_at)}</td>
                  <td className="py-1.5">{s.source === 'gspro' ? 'GSPro' : 'Square Golf'}</td>
                  <td className="py-1.5 text-right">{s.row_count}</td>
                  <td className="text-muted py-1.5 pl-4">{s.notes ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </main>
  );
}
