import { SG_CATEGORIES, type GradingTotals } from '@caddymate/engine';
import { BarChart } from '@/components/charts/bar-chart';
import { CATEGORY_LABELS, NEGATIVE, POSITIVE } from '@/components/charts/palette';
import { sgText } from '@/lib/review/format';
import { decisionSummary, explainDecision } from '@/lib/review/round';
import type { ReviewShot } from '@/lib/review/shots';

/**
 * Decision grading (docs/SPEC.md §9.5, §14): the 2×2, strokes lost to
 * strategy vs execution, per category and club, and the five most
 * expensive shots with explanations from their snapshots.
 */
export function Decisions({
  shots,
  clubNames,
}: {
  shots: ReviewShot[];
  clubNames: Record<string, string>;
}) {
  const s = decisionSummary(shots);
  if (s.totals.count === 0) {
    return (
      <p className="text-muted text-sm">No shots with a recommendation snapshot were graded.</p>
    );
  }
  const m = s.matrix;
  const cell = (n: number, label: string, tone: 'good' | 'mixed' | 'poor') => (
    <div
      className={`rounded-lg border p-3 ${
        tone === 'good' ? 'border-accent' : tone === 'poor' ? 'border-danger' : 'border-border'
      }`}
    >
      <p className="text-2xl font-bold" style={{ fontVariantNumeric: 'tabular-nums' }}>
        {n}
      </p>
      <p className="text-muted text-xs">{label}</p>
    </div>
  );
  // Execution loss is signed (+ = better than the pattern); show strokes LOST as positive.
  const lostToExecution = -s.totals.executionLoss;
  const lossBars = (t: GradingTotals) => [t.strategyLoss, -t.executionLoss];
  const categoryRows = SG_CATEGORIES.flatMap((c) => {
    const t = s.byCategory[c];
    if (!t) return [];
    const [strategy, execution] = lossBars(t);
    return [
      {
        label: CATEGORY_LABELS[c],
        value: strategy! + execution!,
        note: `n ${String(t.count)}`,
        title: `${CATEGORY_LABELS[c]}: strategy ${strategy!.toFixed(2)}, execution ${sgText(execution!)} strokes lost`,
      },
    ];
  });
  const clubRows = Object.entries(s.byClub)
    .map(([id, t]) => {
      const [strategy, execution] = lossBars(t);
      return {
        label: clubNames[id] ?? '?',
        value: strategy! + execution!,
        note: `n ${String(t.count)}`,
        title: `strategy ${strategy!.toFixed(2)}, execution ${sgText(execution!)} strokes lost`,
      };
    })
    .sort((a, b) => b.value - a.value);
  const lostColour = (v: number) => (v > 0 ? NEGATIVE : POSITIVE);

  return (
    <div className="space-y-6">
      <div className="grid gap-6 md:grid-cols-2">
        <div>
          <div className="text-muted mb-1 grid grid-cols-[auto_1fr_1fr] gap-2 text-xs">
            <span />
            <span className="text-center">Good execution</span>
            <span className="text-center">Poor execution</span>
          </div>
          <div className="grid grid-cols-[auto_1fr_1fr] items-center gap-2">
            <span className="text-muted text-xs [writing-mode:vertical-rl] rotate-180">
              Good decision
            </span>
            {cell(m.goodDecisionGoodExecution, 'Good · good', 'good')}
            {cell(m.goodDecisionPoorExecution, 'Good decision, poor strike', 'mixed')}
            <span className="text-muted text-xs [writing-mode:vertical-rl] rotate-180">
              Poor decision
            </span>
            {cell(m.poorDecisionGoodExecution, 'Poor decision, good strike', 'mixed')}
            {cell(m.poorDecisionPoorExecution, 'Poor · poor', 'poor')}
          </div>
        </div>
        <dl
          className="grid grid-cols-2 gap-3 self-start"
          style={{ fontVariantNumeric: 'tabular-nums' }}
        >
          <div className="rounded-lg border border-border p-3">
            <dt className="text-muted text-xs">Lost to strategy</dt>
            <dd className="text-2xl font-bold">{s.totals.strategyLoss.toFixed(2)}</dd>
          </div>
          <div className="rounded-lg border border-border p-3">
            <dt className="text-muted text-xs">Lost to execution</dt>
            <dd className="text-2xl font-bold">{sgText(lostToExecution)}</dd>
          </div>
          <p className="text-muted col-span-2 text-xs">
            Strokes versus the engine&apos;s best option executed as the pattern predicts, over{' '}
            {s.totals.count} graded shots. Negative execution loss means you beat the pattern.
          </p>
        </dl>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <div>
          <h3 className="mb-2 text-sm font-semibold">Strokes lost by category</h3>
          <BarChart
            title="Strokes lost by shot category"
            data={categoryRows.map((r) => ({ ...r, colour: lostColour(r.value) }))}
            format={(v) => sgText(v)}
          />
        </div>
        <div>
          <h3 className="mb-2 text-sm font-semibold">Strokes lost by club</h3>
          <BarChart
            title="Strokes lost by club"
            data={clubRows.map((r) => ({ ...r, colour: lostColour(r.value) }))}
            format={(v) => sgText(v)}
          />
        </div>
      </div>

      <div>
        <h3 className="mb-2 text-sm font-semibold">Most expensive shots</h3>
        {s.mostExpensive.length === 0 ? (
          <p className="text-muted text-sm">No shot cost strokes against the best option.</p>
        ) : (
          <ol className="space-y-2">
            {s.mostExpensive.map(({ shot: g, cost }) => (
              <li key={g.shot.id} className="rounded-lg border border-border p-3 text-sm">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-semibold">
                    Hole {g.shot.holeNumber}, shot {g.shot.seq} ·{' '}
                    {g.shot.clubId ? (clubNames[g.shot.clubId] ?? '?') : '—'}
                  </span>
                  <span className="text-danger" style={{ fontVariantNumeric: 'tabular-nums' }}>
                    −{cost.toFixed(2)}
                  </span>
                </div>
                {explainDecision(g, g.shot.clubId ? (clubNames[g.shot.clubId] ?? null) : null).map(
                  (line, i) => (
                    <p key={i} className={i === 0 ? '' : 'text-muted'}>
                      {line}
                    </p>
                  ),
                )}
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}
