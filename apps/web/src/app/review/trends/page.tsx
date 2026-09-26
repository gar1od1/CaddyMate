import Link from 'next/link';
import { redirect } from 'next/navigation';
import { listClubs, type Db } from '@caddymate/api';
import {
  SG_CATEGORIES,
  metresToYards,
  type RecommendationSnapshot,
  type SgCategory,
} from '@caddymate/engine';
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
import { NAV_TREE, activeView, findNode } from '@/lib/nav/tree';
import { BarChart } from '@/components/charts/bar-chart';
import { LineChart } from '@/components/charts/line-chart';
import { CATEGORY_COLOURS, CATEGORY_LABELS, MUTED } from '@/components/charts/palette';
import { Card } from '@/components/primitives/Card';
import {
  FilterableTable,
  type FilterableColumn,
  type FilterableRow,
} from '@/components/primitives/FilterableTable';
import { Page, PageHeader } from '@/components/primitives/Page';
import { CoursePicker } from './course-picker';

export const metadata = { title: 'Trends · CaddyMate' };

const WINDOWS = [5, 10, 20] as const;

type SearchParams = { course?: string; w?: string; view?: string };

/**
 * Trends has three views (SubNav, lib/nav/tree.ts): strokes gained, the
 * course view and the handicap ledger. Each view reads only what it shows.
 */
export default async function TrendsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/sign-in');
  const db = supabase as unknown as Db;

  const node = findNode(NAV_TREE, 'review.trends')!;
  const view = activeView(node, new URLSearchParams(sp.view ? { view: sp.view } : {}))!.key;
  const rounds = await listRoundRows(db, 200);
  const played = rounds.filter((r) => r.status !== 'abandoned');

  return (
    <Page>
      <PageHeader
        title="Trends"
        description={`${String(played.length)} rounds played${
          rounds.length > played.length
            ? `, ${String(rounds.length - played.length)} abandoned`
            : ''
        }`}
      />
      {view === 'course' ? (
        <CourseView db={db} played={played} sp={sp} />
      ) : view === 'handicap' ? (
        <HandicapView db={db} userId={user.id} rounds={rounds} />
      ) : (
        <StrokesGainedView db={db} played={played} sp={sp} />
      )}
    </Page>
  );
}

type Rounds = Awaited<ReturnType<typeof listRoundRows>>;

/** Keeps the page's other parameters on in-page controls. */
const qs = (sp: SearchParams, patch: Partial<SearchParams>) => {
  const all = { ...sp, ...patch };
  return new URLSearchParams(
    Object.entries(all).filter((e): e is [string, string] => !!e[1]),
  ).toString();
};

async function StrokesGainedView({ db, played, sp }: { db: Db; played: Rounds; sp: SearchParams }) {
  const ids = played.map((r) => r.round_id);
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

  return (
    <Card
      title="Strokes gained, rolling average per round"
      actions={
        <nav className="flex gap-1 text-sm" aria-label="Window">
          {WINDOWS.map((w) => (
            <Link
              key={w}
              href={`?${qs(sp, { w: String(w) })}`}
              scroll={false}
              aria-current={w === win ? 'true' : undefined}
              className={`inline-flex min-h-[var(--tap)] items-center rounded-md px-3 ${
                w === win ? 'bg-accent text-accent-text font-semibold' : 'border border-border'
              }`}
            >
              Last {w}
            </Link>
          ))}
        </nav>
      }
    >
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
          {/* A fixed three-row summary grid, not a table of records: exempt from filters. */}
          <div
            className="table-scroll"
            role="region"
            aria-label="Latest rolling strokes gained"
            tabIndex={0}
          >
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
                      <td className="py-1.5 whitespace-nowrap">
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
          </div>
        </>
      )}
    </Card>
  );
}

async function CourseView({ db, played, sp }: { db: Db; played: Rounds; sp: SearchParams }) {
  const byCourse = new Map<string, { name: string; rounds: Rounds }>();
  for (const r of played) {
    const e = byCourse.get(r.course_id) ?? { name: r.courses?.name ?? '?', rounds: [] };
    e.rounds.push(r);
    byCourse.set(r.course_id, e);
  }
  const courseIds = [...byCourse.keys()].sort(
    (a, b) => byCourse.get(b)!.rounds.length - byCourse.get(a)!.rounds.length,
  );
  const courseId = sp.course && byCourse.has(sp.course) ? sp.course : courseIds[0];
  if (!courseId) {
    return (
      <Card title="Course view">
        <p className="text-muted text-sm">No rounds played yet.</p>
      </Card>
    );
  }
  const courseRounds = byCourse.get(courseId)!.rounds;
  const courseRoundIds = courseRounds.map((r) => r.round_id);
  const versions = [...new Set(courseRounds.map((r) => r.course_version))];

  const [clubs, holeRows, scoreRows, teeRows] = await Promise.all([
    listClubs(db),
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
  ]);
  const clubNames = Object.fromEntries(clubs.map((c) => [c.id, c.name]));
  const clubName = (id: string) => clubNames[id] ?? '?';
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

  return (
    <Card
      title={`Course view · ${byCourse.get(courseId)!.name}`}
      actions={
        courseIds.length > 1 ? (
          <CoursePicker
            value={courseId}
            query={Object.fromEntries(
              Object.entries({ w: sp.w, view: sp.view }).filter(
                (e): e is [string, string] => !!e[1],
              ),
            )}
            options={courseIds.map((id) => ({
              value: id,
              label: byCourse.get(id)!.name,
              hint: `${String(byCourse.get(id)!.rounds.length)} rounds`,
            }))}
          />
        ) : null
      }
    >
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

      <div className="space-y-4">
        <h3 className="text-sm font-semibold">Tee strategy on par 4s and 5s</h3>
        {teeByPar.length === 0 ? (
          <p className="text-muted text-sm">No tee shots on par 4/5 holes yet.</p>
        ) : (
          <>
            {teeByPar.map((g) => (
              <TeeTable
                key={g.par}
                prefix={`p${String(g.par)}.`}
                caption={`All par ${String(g.par)}s · ${String(g.shots)} tee shots`}
                clubs={g.clubs}
                clubName={clubName}
              />
            ))}
            <details>
              <summary className="text-muted cursor-pointer text-sm">Per hole</summary>
              <div className="mt-3 space-y-4">
                {teeByHole.map((h) => (
                  <TeeTable
                    key={h.holeNumber}
                    prefix={`h${String(h.holeNumber)}.`}
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
    </Card>
  );
}

async function HandicapView({ db, userId, rounds }: { db: Db; userId: string; rounds: Rounds }) {
  const profileRes = await db
    .from('profiles')
    .select('handicap_index_official')
    .eq('user_id', userId)
    .maybeSingle();
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

  const columns: FilterableColumn[] = [
    { key: 'date', label: 'Date', filter: 'date' },
    { key: 'course', label: 'Course' },
    { key: 'gross', label: 'Adj. gross', filter: 'number', align: 'right' },
    { key: 'diff', label: 'Differential', filter: 'number', align: 'right' },
    { key: 'counts', label: 'Counts', align: 'right' },
  ];
  const rows: FilterableRow[] = ledger.entries.map((e) => ({
    key: e.roundId,
    tone: e.counts ? 'strong' : 'muted',
    cells: {
      date: { text: fmtDate(e.date), href: `/review/${e.roundId}`, sortValue: e.date },
      course: { text: e.courseName ?? '—' },
      gross: {
        text: e.adjustedGross === null ? '—' : String(e.adjustedGross),
        sortValue: e.adjustedGross,
      },
      diff: { text: e.differential.toFixed(1), sortValue: e.differential },
      counts: { text: e.counts ? 'Counts' : 'Does not count' },
    },
  }));

  return (
    <Card title="Handicap (WHS)">
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
      <FilterableTable
        label="WHS ledger"
        columns={columns}
        rows={rows}
        emptyMessage="No rounds with a differential yet."
      />
    </Card>
  );
}

const TEE_COLUMNS: FilterableColumn[] = [
  { key: 'club', label: 'Club' },
  { key: 'used', label: 'Used', filter: 'number', align: 'right' },
  { key: 'sg', label: 'Avg SG', filter: 'number', align: 'right' },
  { key: 'fairway', label: 'Fairway', filter: 'number', align: 'right' },
  { key: 'penalty', label: 'Penalty', filter: 'number', align: 'right' },
  { key: 'yds', label: 'Avg yds', filter: 'number', align: 'right' },
  { key: 'pick', label: "Engine's pick", filter: 'number', align: 'right' },
  { key: 'expected', label: 'Exp. strokes', filter: 'number', align: 'right' },
];

function TeeTable({
  caption,
  prefix,
  clubs,
  clubName,
}: {
  caption: string;
  prefix: string;
  clubs: TeeClubStats[];
  clubName: (id: string) => string;
}) {
  // Range filters compare `sortValue`, so it is in the unit shown (yards, percent).
  const num = (v: number | null, text: string) => ({ text: v === null ? '—' : text, sortValue: v });
  const pct = (p: number) => num(p * 100, pctText(p));
  const rows: FilterableRow[] = clubs.map((c) => ({
    key: c.clubId,
    cells: {
      club: { text: clubName(c.clubId) },
      used: num(c.n, String(c.n)),
      sg: num(c.meanSg, sgText(c.meanSg)),
      fairway: c.n ? pct(c.fairwayRate) : { text: '—' },
      penalty: c.n ? pct(c.penaltyRate) : { text: '—' },
      yds: num(
        c.meanDistanceM === null ? null : metresToYards(c.meanDistanceM),
        yds(c.meanDistanceM),
      ),
      pick: num(c.engineFirst, `${String(c.engineFirst)}×`),
      expected: num(c.meanExpected, c.meanExpected?.toFixed(2) ?? '—'),
    },
  }));
  return (
    <FilterableTable
      label={caption}
      caption={caption}
      paramPrefix={prefix}
      columns={TEE_COLUMNS}
      rows={rows}
    />
  );
}
