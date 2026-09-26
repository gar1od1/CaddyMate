import { notFound, redirect } from 'next/navigation';
import {
  PATTERN_SHOT_COLUMNS,
  clubFromRow,
  effectivePattern,
  listClubConditionPatterns,
  storedClubPatternFromRow,
  type Db,
  type PatternShotRow,
} from '@caddymate/api';
import { metresToYards, yardsToMetres } from '@caddymate/engine';
import { createClient } from '@/lib/supabase/server';
import { ScatterPlot, type Overlay } from '@/components/charts/scatter-plot';
import { SERIES } from '@/components/charts/palette';
import {
  bucketLabel,
  levelLabel,
  patternContours,
  scatterExtent,
  scatterPoints,
} from '@/lib/review/dispersion';
import { fmtDate, pctText, yds } from '@/lib/review/format';
import { Card } from '@/components/primitives/Card';
import {
  FilterableTable,
  type FilterableColumn,
  type FilterableRow,
} from '@/components/primitives/FilterableTable';
import { Page, PageHeader } from '@/components/primitives/Page';
import { RefitButton } from '../refit-button';

export const metadata = { title: 'Club dispersion · CaddyMate' };

const SIM = SERIES[0];
const COURSE = SERIES[1];
const CONTOUR = '#f4f7f5';

export default async function ClubPage({ params }: { params: Promise<{ clubId: string }> }) {
  const { clubId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/sign-in');
  const db = supabase as unknown as Db;

  const { data: clubRow } = await db.from('clubs').select('*').eq('club_id', clubId).maybeSingle();
  if (!clubRow) notFound();
  const club = clubFromRow(clubRow);
  const [patternRes, buckets, shotRes] = await Promise.all([
    db.from('club_patterns').select('*').eq('club_id', clubId).maybeSingle(),
    listClubConditionPatterns(db, clubId),
    db.from('shots').select(PATTERN_SHOT_COLUMNS).eq('club_id', clubId),
  ]);
  const stored = patternRes.data ? storedClubPatternFromRow(patternRes.data) : null;
  const pattern =
    club.kind === 'putter'
      ? null
      : (stored?.params ??
        effectivePattern(
          { kind: club.kind, loftDeg: club.loftDeg, stockTotalM: club.stockTotalM },
          null,
        ));
  const points = scatterPoints((shotRes.data ?? []) as unknown as PatternShotRow[]);
  const contours = pattern ? patternContours(pattern) : [];
  const ext = scatterExtent(
    points,
    contours.map((c) => c.ring),
  );
  const dashed = pattern?.confidence !== 'established';
  const overlays: Overlay[] = contours.map((c) => ({
    points: c.ring.map((p) => ({ x: p.lateralM, y: p.alongM })),
    colour: CONTOUR,
    dashed,
    fillOpacity: c.level === 1 ? 0.1 : 0.03,
    label: `${levelLabel(c.level)} contour`,
  }));
  const simN = points.filter((p) => p.source === 'sim').length;
  const courseN = points.length - simN;
  const yd = (m: number) => `${yds(m)}`;

  const bucketColumns: FilterableColumn[] = [
    { key: 'lie', label: 'Lie' },
    { key: 'head', label: 'Head wind (m/s)' },
    { key: 'cross', label: 'Cross wind (m/s)' },
    { key: 'neff', label: 'n eff.', filter: 'number', align: 'right' },
    { key: 'mean', label: 'Mean yds', filter: 'number', align: 'right' },
    { key: 'bias', label: 'Bias', filter: 'number', align: 'right', title: 'Negative is left' },
    { key: 'sd', label: 'SD L / R', filter: false, sort: false, align: 'right' },
  ];
  const bucketRows: FilterableRow[] = buckets
    .sort((a, b) => b.nEffective - a.nEffective)
    .map((b) => {
      const l = bucketLabel(b.bucketKey);
      const bias = b.params.lateral.mean;
      return {
        key: b.bucketKey,
        cells: {
          lie: { text: l.lie },
          head: { text: l.head },
          cross: { text: l.cross },
          neff: { text: b.nEffective.toFixed(1), sortValue: b.nEffective },
          mean: {
            text: yds(b.params.distance.mean),
            sortValue: metresToYards(b.params.distance.mean),
          },
          bias: {
            text: `${yds(Math.abs(bias), 1)} ${bias < 0 ? 'L' : bias > 0 ? 'R' : ''}`,
            sortValue: metresToYards(bias),
          },
          sd: {
            text: `${yds(b.params.lateral.sd_left, 1)} / ${yds(b.params.lateral.sd_right, 1)}`,
          },
        },
      };
    });

  return (
    <Page>
      <PageHeader
        title={club.name}
        description={
          <>
            {club.kind}
            {club.loftDeg !== null ? ` · ${String(club.loftDeg)}°` : ''}
            {stored
              ? ` · fitted ${fmtDate(stored.fittedAt)} (engine v${String(stored.engineVersion)})`
              : ' · no stored pattern — showing the seeded prior'}
          </>
        }
        actions={club.kind !== 'putter' ? <RefitButton clubIds={[club.id]} /> : null}
      />

      {pattern ? (
        <section className="grid gap-6 lg:grid-cols-[1fr_300px]">
          <div className="card">
            <h2 className="mb-2 font-semibold">Neutral shots and current pattern</h2>
            <ScatterPlot
              title={`${club.name} dispersion: neutral results with 1σ, 80 % and 95 % contours`}
              points={points.map((p) => ({
                x: p.lateralM,
                y: p.alongM,
                colour: p.source === 'sim' ? SIM : COURSE,
                hollow: !p.good,
                title: `${p.source} · ${fmtDate(p.playedAt)} · ${yds(p.alongM)} yds, ${yds(Math.abs(p.lateralM))} ${p.lateralM < 0 ? 'L' : 'R'}${p.good ? '' : ' · mishit'}`,
              }))}
              overlays={overlays}
              xDomain={ext.lateral}
              yDomain={ext.along}
              xLabel="Left ← yards → right"
              yLabel="Distance (yards)"
              tickFormat={yd}
              toTickUnit={metresToYards}
              fromTickUnit={yardsToMetres}
              legend={
                <span className="text-muted flex flex-wrap gap-x-4 gap-y-1">
                  <span className="inline-flex items-center gap-1.5">
                    <Dot colour={SIM} /> Sim ({simN})
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <Dot colour={COURSE} /> Course ({courseN})
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <Dot colour={SIM} hollow /> Mishit
                  </span>
                  <span>
                    Contours: 1σ / 80 % / 95 %{dashed ? ' (dashed: not yet established)' : ''}
                  </span>
                </span>
              }
            />
          </div>
          <aside className="card space-y-3 text-sm" style={{ fontVariantNumeric: 'tabular-nums' }}>
            <h2 className="font-semibold">Pattern</h2>
            <dl className="grid grid-cols-2 gap-x-3 gap-y-1">
              <dt className="text-muted">Confidence</dt>
              <dd>{pattern.confidence}</dd>
              <dt className="text-muted">n effective</dt>
              <dd>{pattern.n_effective.toFixed(1)}</dd>
              <dt className="text-muted">n raw</dt>
              <dd>
                {pattern.n_raw} ({pattern.n_sim} sim, {pattern.n_course} course)
              </dd>
              <dt className="text-muted">Distance</dt>
              <dd>
                {yds(pattern.distance.mean)} ± {yds(pattern.distance.sd)} yds
              </dd>
              <dt className="text-muted">q10 / q50 / q90</dt>
              <dd>
                {yds(pattern.distance.q10)} / {yds(pattern.distance.q50)} /{' '}
                {yds(pattern.distance.q90)}
              </dd>
              <dt className="text-muted">Bias</dt>
              <dd>
                {yds(Math.abs(pattern.lateral.mean), 1)}{' '}
                {pattern.lateral.mean < 0 ? 'L' : pattern.lateral.mean > 0 ? 'R' : ''}
              </dd>
              <dt className="text-muted">SD left / right</dt>
              <dd>
                {yds(pattern.lateral.sd_left, 1)} / {yds(pattern.lateral.sd_right, 1)} yds
              </dd>
              <dt className="text-muted">ρ</dt>
              <dd>{pattern.rho.toFixed(2)}</dd>
              <dt className="text-muted">Mishits</dt>
              <dd>{pctText(pattern.miss.p_miss)}</dd>
            </dl>
            <p className="text-faint text-xs">
              Seeded &lt; 12, forming 12–30, established &gt; 30 effective shots.
            </p>
          </aside>
        </section>
      ) : (
        <p className="text-muted card text-sm">Putters have no dispersion pattern.</p>
      )}

      <Card title="Condition buckets (observed, ≥ 15 effective shots)">
        <FilterableTable
          label="Condition buckets"
          columns={bucketColumns}
          rows={bucketRows}
          emptyMessage="No condition bucket has enough shots yet; on course the pattern is estimated from the neutral fit."
        />
      </Card>
    </Page>
  );
}

function Dot({ colour, hollow = false }: { colour: string; hollow?: boolean }) {
  return (
    <svg width="10" height="10" aria-hidden>
      <circle
        cx="5"
        cy="5"
        r="4"
        fill={hollow ? 'none' : colour}
        stroke={colour}
        strokeWidth={hollow ? 1.5 : 0}
      />
    </svg>
  );
}
