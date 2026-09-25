import { SG_CATEGORIES } from '@caddymate/engine';
import { BarChart } from '@/components/charts/bar-chart';
import { CATEGORY_LABELS } from '@/components/charts/palette';
import { sgText } from '@/lib/review/format';
import { roundSg } from '@/lib/review/round';
import type { ReviewShot } from '@/lib/review/shots';

/** Strokes gained per category and per club (OTT + APP) for one round (§10.1). */
export function StrokesGained({
  shots,
  clubNames,
}: {
  shots: ReviewShot[];
  clubNames: Record<string, string>;
}) {
  const sg = roundSg(shots);
  const clubs = Object.entries(sg.byClub)
    .map(([id, c]) => ({
      label: clubNames[id] ?? '?',
      value: c.sg,
      note: `n ${String(c.count)}`,
    }))
    .sort((a, b) => b.value - a.value);
  return (
    <div className="space-y-4">
      <p className="text-3xl font-bold" style={{ fontVariantNumeric: 'tabular-nums' }}>
        {sgText(sg.total)}{' '}
        <span className="text-muted text-sm font-normal">SG total vs scratch</span>
      </p>
      <div className="grid gap-6 md:grid-cols-2">
        <div>
          <h3 className="mb-2 text-sm font-semibold">By category</h3>
          <BarChart
            title="Strokes gained by category"
            data={SG_CATEGORIES.map((c) => ({
              label: CATEGORY_LABELS[c],
              value: sg.byCategory[c],
              note: `n ${String(sg.counts[c])}`,
            }))}
          />
        </div>
        <div>
          <h3 className="mb-2 text-sm font-semibold">By club (tee and approach shots)</h3>
          {clubs.length ? (
            <BarChart title="Strokes gained by club" data={clubs} />
          ) : (
            <p className="text-muted text-sm">No graded tee or approach shots.</p>
          )}
        </div>
      </div>
    </div>
  );
}
