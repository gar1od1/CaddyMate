import Link from 'next/link';
import { redirect } from 'next/navigation';
import { listClubs, type Db } from '@caddymate/api';
import { SG_CATEGORIES, type RecommendationSnapshot, type SgCategory } from '@caddymate/engine';
import { createClient } from '@/lib/supabase/server';
import { listRoundRows, selectInChunks } from '@/lib/review/data';
import { fmtDate, fmtShortDate, pctText, sgText, yds } from '@/lib/review/format';
import {
  holeScoringAverages,
  rollingSgSeries,
  roundSgSeries,
  teeStrategy,
  teeStrategyByHole,
  whsLedger,
  type TeeClubStats,
  type TeeShotLite,
} from '@/lib/review/trends';
import { BarChart } from '@/components/charts/bar-chart';
import { LineChart } from '@/components/charts/line-chart';
import { CATEGORY_COLOURS, CATEGORY_LABELS, MUTED } from '@/components/charts/palette';

export const metadata = { title: 'Trends · CaddyMate' };

const WINDOWS = [5, 10, 20] as const;

export default async function TrendsPage({
  searchParams,
}: {
  searchParams: Promise<{ course?: string; w?: string }>;
}) {
  const sp = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/sign-in');
  const db = supabase as unknown as Db;

  const [rounds, clubs, profileRes] = await Promise.all([
    listRoundRows(db, 200),
    listClubs(db),
    db.from('profiles').select('handicap_index_official').eq('user_id', user.id).maybeSingle(),
  ]);
  const clubNames = Object.fromEntries(clubs.map((c) => [c.id, c.name]));
  const clubName = (id: string) => clubNames[id] ?? '?';
  const played = rounds.filter((r) => r.status !== 'abandoned');
  const ids = played.map((r) => r.round_id);

  // --- Strokes gained ------------------------------------------------------
  const sgRows = await selectInChunks(ids, (c) =>
    db
      .from('shots')
      .select('round_id, sg, sg_category, club_id')
      .in('round_id', c)
      .not('sg', 'is', null),
  );
  const series = roundSgSeries(
    played.map((r) => ({
      roundId: r.round_id,
      date: r.started_at,
      shots: sgRows
        .filter((s) => s.round_id === r.round_id)
        .map((s) => ({
          sg: s.sg === null ? null : Number(s.sg),
          sgCategory: s.sg_category as SgCategory | null,
          clubId: s.club_id,
        })),
    })),
  );
  const win = WINDOWS.find((w) => String(w) === sp.w) ?? 5;
  const rolling = rollingSgSeries(series, WINDOWS);
  const current = rolling.find((r) => r.window === win)!;

  // --- Course view ----------------------------------------------------------
  const byCourse = new Map<string, { name: string; rounds: typeof played }>();
  for (const r of played) {
    const e = byCourse.get(r.course_id) ?? { name: r.courses?.name ?? '?', rounds: [] };
    e.rounds.push(r);
    byCourse.set(r.course_id, e);
  }
  const courseIds = [...byCourse.keys()].sort(
    (a, b) => byCourse.get(b)!.rounds.length - byCourse.get(a)!.rounds.length,
  );
  const courseId = sp.course && byCourse.has(sp.course) ? sp.course : courseIds[0];
  const courseRounds = courseId ? byCourse.get(courseId)!.rounds : [];
  const courseRoundIds = courseRounds.map((r) => r.round_id);

  const versions = [...new Set(courseRounds.map((r) => r.course_version))];
  const [holeRows, scoreRows, teeRows] = courseId
    ? await Promise.all([
        db
          .from('holes')
          .select('hole_number, par, version')
          .eq('course_id', courseId)
          .in('version', versions)
          .then((r) => r.data ?? []),
        selectInChunks(courseRoundIds, (c) =>
          db
            .from('hole_scores')
            .select('round_id, hole_number, strokes_logged, strokes_override')
            .in('round_id', c),
        ),
        selectInChunks(courseRoundIds, (c) =>
          db
            .from('shots')
            .select(
              'round_id, hole_number, club_id, sg, result_surface, penalty, observed_distance_m, recommendation',
            )
            .in('round_id', c)
            .eq('seq', 1),
        ),
      ])
    : [[], [], []];
  const versionOf = new Map(courseRounds.map((r) => [r.round_id, r.course_version]));
  const parOf = (roundId: string, hole: number) =>
    holeRows.find((h) => h.hole_number === hole && h.version === versionOf.get(roundId))?.par ??
    holeRows.find((h) => h.hole_number === hole)?.par ??
    4;
  const holeAverages = holeScoringAverages(
    scoreRows.map((s) => ({
      holeNumber: s.hole_number,
      par: parOf(s.round_id, s.hole_number),
      strokes: s.strokes_override ?? s.strokes_logged,
    })),
  );
  const teeShots: TeeShotLite[] = teeRows.flatMap((s) =>
    s.round_id && s.hole_number !== null
      ? [
          {
            holeNumber: s.hole_number,
            par: parOf(s.round_id, s.hole_number),
            clubId: s.club_id,
            sg: s.sg === null ? null : Number(s.sg),
            resultSurface: s.result_surface,
            penalty: s.penalty,
            observedDistanceM:
              s.observed_distance_m === null ? null : Number(s.observed_distance_m),
            recommendation: s.recommendation as unknown as RecommendationSnapshot | null,
          },
        ]
      : [],
  );
  const teeByPar = teeStrategy(teeShots);
  const teeByHole = teeStrategyByHole(teeShots);

  // --- WHS -------------------------------------------------------------------
  const ledger = whsLedger(
    rounds.map((r) => ({
      roundId: r.round_id,
      date: r.started_at,
      differential: r.differential === null ? null : Number(r.differential),
      courseName: r.courses?.name ?? null,
      adjustedGross: r.adjusted_gross,
    })),
  );
  const official = profileRes.data?.handicap_index_official ?? null;

  return (
    <main className="mx-auto w-full max-w-5xl space-y-6 p-6">
      <header>
        <Link href="/review" className="link text-sm">
          ← Rounds
        </Link>
        <h1 className="text-2xl font-bold">Trends</h1>
      </header>

      <section className="card space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">Strokes gained, rolling average per round</h2>
          <nav className="flex gap-1 text-sm" aria-label="Window">
            {WINDOWS.map((w) => (
              <Link
                key={w}
                href={`?${new URLSearchParams({ ...(courseId ? { course: courseId } : {}), w: String(w) }).toString()}`}
                className={`rounded-md px-3 py-1 ${
                  w === win ? 'bg-accent text-accent-text font-semibold' : 'border border-border'
                }`}
              >
                Last {w}
              </Link>
            ))}
          </nav>
        </div>
        {series.length === 0 ? (
          <p className="text-muted text-sm">No graded rounds yet.</p>
        ) : (
          <>
            <LineChart
              title={`Rolling ${String(win)}-round strokes gained by category`}
              xLabels={current.points.map((p) => fmtShortDate(p.date))}
              series={[
                ...SG_CATEGORIES.map((c) => ({
                  name: CATEGORY_LABELS[c],
                  colour: CATEGORY_COLOURS[c],
                  values: current.points.map((p) => p.byCategory[c]),
                })),
                {
                  name: 'Total',
                  colour: MUTED,
                  dashed: true,
                  values: current.points.map((p) => p.total),
                },
              ]}
            />
            <table className="w-full text-sm" style={{ fontVariantNumeric: 'tabular-nums' }}>
              <thead className="text-muted text-xs uppercase">
                <tr className="border-b border-border">
                  <th className="py-2 text-left font-medium">Latest</th>
                  {SG_CATEGORIES.map((c) => (
                    <th key={c} className="py-2 text-right font-medium">
                      {CATEGORY_LABELS[c]}
                    </th>
                  ))}
                  <th className="py-2 text-right font-medium">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rolling.map((r) => {
                  const last = r.points.at(-1)!;
                  return (
                    <tr key={r.window}>
                      <td className="py-1.5">
                        Last {r.window} <span className="text-faint">(n {last.n})</span>
                      </td>
                      {SG_CATEGORIES.map((c) => (
                        <td key={c} className="py-1.5 text-right">
                          {sgText(last.byCategory[c])}
                        </td>
                      ))}
                      <td className="py-1.5 text-right font-semibold">{sgText(last.total)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </>
        )}
      </section>

      <section className="card space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">
            Course view{courseId ? ` · ${byCourse.get(courseId)!.name}` : ''}
          </h2>
          {courseIds.length > 1 ? (
            <nav className="flex flex-wrap gap-1 text-sm" aria-label="Course">
              {courseIds.map((id) => (
                <Link
                  key={id}
                  href={`?${new URLSearchParams({ course: id, w: String(win) }).toString()}`}
                  className={`rounded-md px-3 py-1 ${
                    id === courseId
                      ? 'bg-accent text-accent-text font-semibold'
                      : 'border border-border'
                  }`}
                >
                  {byCourse.get(id)!.name} ({byCourse.get(id)!.rounds.length})
                </Link>
              ))}
            </nav>
          ) : null}
        </div>
        {holeAverages.length === 0 ? (
          <p className="text-muted text-sm">No scores recorded yet.</p>
        ) : (
          <div>
            <h3 className="mb-2 text-sm font-semibold">Scoring average vs par, per hole</h3>
            <BarChart
              title="Scoring average relative to par per hole"
              labelWidth={90}
              rowHeight={22}
              data={holeAverages.map((h) => ({
                label: `Hole ${String(h.holeNumber)}`,
                note: `par ${String(h.par)}`,
                value: h.toPar,
                // Over par is strokes lost: the negative pole.
                colour: h.toPar > 0 ? '#e66767' : '#3987e5',
                title: `Hole ${String(h.holeNumber)} (par ${String(h.par)}): average ${h.average.toFixed(2)} over ${String(h.n)} rounds, par or better ${pctText(h.parOrBetter)}`,
              }))}
            />
          </div>
        )}

        <div className="space-y-3">
          <h3 className="text-sm font-semibold">Tee strategy on par 4s and 5s</h3>
          {teeByPar.length === 0 ? (
            <p className="text-muted text-sm">No tee shots on par 4/5 holes yet.</p>
          ) : (
            <>
              {teeByPar.map((g) => (
                <TeeTable
                  key={g.par}
                  caption={`All par ${String(g.par)}s · ${String(g.shots)} tee shots`}
                  clubs={g.clubs}
                  clubName={clubName}
                />
              ))}
              <details>
                <summary className="text-muted cursor-pointer text-sm">Per hole</summary>
                <div className="mt-3 space-y-3">
                  {teeByHole.map((h) => (
                    <TeeTable
                      key={h.holeNumber}
                      caption={`Hole ${String(h.holeNumber)} · par ${String(h.par)} · ${String(h.shots)} tee shots`}
                      clubs={h.clubs}
                      clubName={clubName}
                    />
                  ))}
                </div>
              </details>
            </>
          )}
        </div>
      </section>

      <section className="card space-y-4">
        <h2 className="text-lg font-semibold">Handicap (WHS)</h2>
        <div className="flex flex-wrap gap-8">
          <div>
            <p className="text-3xl font-bold">{official ?? '—'}</p>
            <p className="text-muted text-xs">Official index</p>
          </div>
          <div>
            <p className="text-3xl font-bold">{ledger.index?.index.toFixed(1) ?? '—'}</p>
            <p className="text-muted text-xs">
              CaddyMate estimate
              {ledger.index
                ? ` · best ${String(ledger.index.used)} of ${String(ledger.index.counted)}${
                    ledger.index.adjustment ? `, ${String(ledger.index.adjustment)} adj.` : ''
                  }`
                : ' · needs 3 scores'}
            </p>
          </div>
        </div>
        <p className="text-faint text-xs">
          Soft/hard caps and exceptional-score reductions are not applied here (no low-index history
          yet).
        </p>
        {ledger.entries.length === 0 ? (
          <p className="text-muted text-sm">No rounds with a differential yet.</p>
        ) : (
          <table className="w-full text-sm" style={{ fontVariantNumeric: 'tabular-nums' }}>
            <thead className="text-muted text-xs uppercase">
              <tr className="border-b border-border">
                <th className="py-2 text-left font-medium">Date</th>
                <th className="py-2 text-left font-medium">Course</th>
                <th className="py-2 text-right font-medium">Adj. gross</th>
                <th className="py-2 text-right font-medium">Differential</th>
                <th className="py-2 text-right font-medium">Counts</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {ledger.entries.map((e) => (
                <tr key={e.roundId} className={e.counts ? 'font-semibold' : 'text-muted'}>
                  <td className="py-1.5">
                    <Link href={`/review/${e.roundId}`} className="hover:underline">
                      {fmtDate(e.date)}
                    </Link>
                  </td>
                  <td className="py-1.5">{e.courseName ?? '—'}</td>
                  <td className="py-1.5 text-right">{e.adjustedGross ?? '—'}</td>
                  <td className="py-1.5 text-right">{e.differential.toFixed(1)}</td>
                  <td className="py-1.5 text-right">{e.counts ? '✓ counts' : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </main>
  );
}

function TeeTable({
  caption,
  clubs,
  clubName,
}: {
  caption: string;
  clubs: TeeClubStats[];
  clubName: (id: string) => string;
}) {
  return (
    <table className="w-full text-sm" style={{ fontVariantNumeric: 'tabular-nums' }}>
      <caption className="text-muted mb-1 text-left text-xs">{caption}</caption>
      <thead className="text-muted text-xs uppercase">
        <tr className="border-b border-border">
          <th className="py-1.5 text-left font-medium">Club</th>
          <th className="py-1.5 text-right font-medium">Used</th>
          <th className="py-1.5 text-right font-medium">Avg SG</th>
          <th className="py-1.5 text-right font-medium">Fairway</th>
          <th className="py-1.5 text-right font-medium">Penalty</th>
          <th className="py-1.5 text-right font-medium">Avg yds</th>
          <th className="py-1.5 text-right font-medium">Engine&apos;s pick</th>
          <th className="py-1.5 text-right font-medium">Exp. strokes</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-border">
        {clubs.map((c) => (
          <tr key={c.clubId}>
            <td className="py-1.5">{clubName(c.clubId)}</td>
            <td className="py-1.5 text-right">{c.n}</td>
            <td className="py-1.5 text-right">{sgText(c.meanSg)}</td>
            <td className="py-1.5 text-right">{c.n ? pctText(c.fairwayRate) : '—'}</td>
            <td className="py-1.5 text-right">{c.n ? pctText(c.penaltyRate) : '—'}</td>
            <td className="py-1.5 text-right">{yds(c.meanDistanceM)}</td>
            <td className="py-1.5 text-right">{c.engineFirst}×</td>
            <td className="py-1.5 text-right">{c.meanExpected?.toFixed(2) ?? '—'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
