import { notFound, redirect } from 'next/navigation';
import type { Db } from '@caddymate/api';
import { createClient } from '@/lib/supabase/server';
import { loadRoundReview } from '@/lib/review/data';
import { fmtDate, sgText } from '@/lib/review/format';
import { roundSg, scorecardTable } from '@/lib/review/round';
import { isRoundGraded } from '@/lib/review/shots';
import { Decisions } from '@/components/review/decisions';
import { Replay, type ReplayHole } from '@/components/review/replay';
import { Scorecard } from '@/components/review/scorecard';
import { StrokesGained } from '@/components/review/strokes-gained';
import { Card } from '@/components/primitives/Card';
import { Page, PageHeader } from '@/components/primitives/Page';

export const metadata = { title: 'Round review · CaddyMate' };

export default async function RoundReviewPage({
  params,
}: {
  params: Promise<{ roundId: string }>;
}) {
  const { roundId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/sign-in');

  const data = await loadRoundReview(supabase as unknown as Db, roundId);
  if (!data) notFound();
  const { round, holeScores, course, shots, clubs, patterns } = data;

  const clubNames = Object.fromEntries(clubs.map((c) => [c.id, c.name]));
  const teeSet = course?.teeSets.find((t) => t.id === round.teeSetId) ?? null;
  const holes: ReplayHole[] = (course?.holes ?? []).map((h) => ({
    number: h.number,
    par: h.par,
    green: h.green,
    greenCentre: h.greenCentre,
    lineOfPlay: h.lineOfPlay,
    features: h.features.map((f) => ({ kind: f.kind, polygon: f.polygon })),
  }));
  const table = scorecardTable(
    (course?.holes ?? []).map((h) => {
      const marker = teeSet?.markers.find((m) => m.holeId === h.id);
      return {
        number: h.number,
        par: h.par,
        strokeIndex: marker?.strokeIndex ?? null,
        yardageM: marker?.yardageM ?? null,
      };
    }),
    holeScores,
    shots,
  );
  const graded = isRoundGraded(shots);
  const sg = graded ? roundSg(shots) : null;
  const net = table.totals.at(-1)?.net ?? null;

  const stat = (label: string, value: string | number | null) => (
    <div>
      <p className="text-2xl font-bold" style={{ fontVariantNumeric: 'tabular-nums' }}>
        {value ?? '—'}
      </p>
      <p className="text-muted text-xs">{label}</p>
    </div>
  );

  return (
    <Page width="wide">
      <PageHeader
        title={course?.course.name ?? 'Round'}
        description={
          <>
            {fmtDate(round.startedAt)}
            {teeSet ? ` · ${teeSet.name} tees` : ''}
            {teeSet?.courseRating != null && teeSet.slopeRating != null
              ? ` (${String(teeSet.courseRating)} / ${String(teeSet.slopeRating)})`
              : ''}
            {round.handicapIndexUsed != null ? ` · HI ${String(round.handicapIndexUsed)}` : ''}
            {round.playingHandicap != null ? ` · PH ${String(round.playingHandicap)}` : ''}
            {` · ${round.status}`}
          </>
        }
        actions={
          <div className="card flex flex-wrap gap-x-8 gap-y-3 px-5 py-3">
            {stat('Gross', round.gross)}
            {stat('Net', net)}
            {stat('Points', round.stableford)}
            {stat('Differential', round.differential)}
            {stat('SG total', sg ? sgText(sg.total) : null)}
          </div>
        }
      />

      <Card title="Replay">
        {shots.length === 0 ? (
          <p className="text-muted text-sm">No shots were logged in this round.</p>
        ) : (
          <Replay
            holes={holes}
            shots={shots}
            patterns={patterns}
            clubNames={clubNames}
            pins={round.pinOverrides}
          />
        )}
      </Card>

      {graded ? (
        <>
          <Card title="Decisions">
            <Decisions shots={shots} clubNames={clubNames} />
          </Card>
          <Card title="Strokes gained">
            <StrokesGained shots={shots} clubNames={clubNames} />
          </Card>
        </>
      ) : (
        <Card title="Decisions and strokes gained">
          <p className="text-muted text-sm">Not graded yet — finish the round in the app.</p>
        </Card>
      )}

      <Card title="Scorecard">
        <Scorecard table={table} />
      </Card>
    </Page>
  );
}
