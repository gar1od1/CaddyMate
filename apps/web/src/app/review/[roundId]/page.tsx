import Link from 'next/link';
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
    <main className="mx-auto w-full max-w-6xl space-y-6 p-6">
      <header className="space-y-3">
        <Link href="/review" className="link text-sm">
          ← Rounds
        </Link>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold">{course?.course.name ?? 'Round'}</h1>
            <p className="text-muted text-sm">
              {fmtDate(round.startedAt)}
              {teeSet ? ` · ${teeSet.name} tees` : ''}
              {teeSet?.courseRating != null && teeSet.slopeRating != null
                ? ` (${String(teeSet.courseRating)} / ${String(teeSet.slopeRating)})`
                : ''}
              {round.handicapIndexUsed != null ? ` · HI ${String(round.handicapIndexUsed)}` : ''}
              {round.playingHandicap != null ? ` · PH ${String(round.playingHandicap)}` : ''}
              {` · ${round.status}`}
            </p>
          </div>
          <div className="card flex gap-8 px-5 py-3">
            {stat('Gross', round.gross)}
            {stat('Net', net)}
            {stat('Points', round.stableford)}
            {stat('Differential', round.differential)}
            {stat('SG total', sg ? sgText(sg.total) : null)}
          </div>
        </div>
      </header>

      <section className="card space-y-3">
        <h2 className="text-lg font-semibold">Replay</h2>
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
      </section>

      {graded ? (
        <>
          <section className="card space-y-3">
            <h2 className="text-lg font-semibold">Decisions</h2>
            <Decisions shots={shots} clubNames={clubNames} />
          </section>
          <section className="card space-y-3">
            <h2 className="text-lg font-semibold">Strokes gained</h2>
            <StrokesGained shots={shots} clubNames={clubNames} />
          </section>
        </>
      ) : (
        <section className="card">
          <h2 className="text-lg font-semibold">Decisions &amp; strokes gained</h2>
          <p className="text-muted mt-1 text-sm">Not graded yet — finish the round in the app.</p>
        </section>
      )}

      <section className="card space-y-3">
        <h2 className="text-lg font-semibold">Scorecard</h2>
        <Scorecard table={table} />
      </section>
    </main>
  );
}
