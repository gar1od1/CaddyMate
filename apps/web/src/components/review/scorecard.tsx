import { sgText, yds } from '@/lib/review/format';
import type { ScorecardTable } from '@/lib/review/round';

const toParClass = (strokes: number | null, par: number) =>
  strokes === null
    ? ''
    : strokes < par
      ? 'text-accent font-semibold'
      : strokes > par + 1
        ? 'text-danger'
        : '';

/**
 * Hole-by-hole card with out/in/total (§5.7). A fixed grid with totals, not a
 * table of records, so it is exempt from header filters (web-ui.md §4.1).
 */
export function Scorecard({ table }: { table: ScorecardTable }) {
  const cols = ['Hole', 'Yds', 'Par', 'SI', 'Score', 'Putts', 'Pen', 'Net', 'Pts', 'SG'];
  return (
    <div className="table-scroll" role="region" aria-label="Scorecard" tabIndex={0}>
      <table className="w-full text-sm" style={{ fontVariantNumeric: 'tabular-nums' }}>
        <thead className="text-muted text-xs uppercase">
          <tr className="border-b border-border">
            {cols.map((c) => (
              <th key={c} className="px-2 py-2 text-right font-medium first:text-left">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {table.rows.map((r) => (
            <tr key={r.hole}>
              <td className="px-2 py-1.5 font-semibold">{r.hole}</td>
              <td className="text-muted px-2 py-1.5 text-right">{yds(r.yardageM)}</td>
              <td className="px-2 py-1.5 text-right">{r.par}</td>
              <td className="text-muted px-2 py-1.5 text-right">{r.strokeIndex ?? '—'}</td>
              <td className={`px-2 py-1.5 text-right ${toParClass(r.strokes, r.par)}`}>
                {r.strokes ?? '—'}
              </td>
              <td className="px-2 py-1.5 text-right">{r.putts ?? '—'}</td>
              <td className="px-2 py-1.5 text-right">
                {r.penalties === null ? '—' : r.penalties || ''}
              </td>
              <td className="px-2 py-1.5 text-right">{r.net ?? '—'}</td>
              <td className="px-2 py-1.5 text-right">{r.points ?? '—'}</td>
              <td className="px-2 py-1.5 text-right">{sgText(r.sg)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot className="border-t-2 border-border font-semibold">
          {table.totals.map((t) => (
            <tr key={t.label}>
              <td className="px-2 py-1.5">{t.label}</td>
              <td className="text-muted px-2 py-1.5 text-right">{yds(t.yardageM)}</td>
              <td className="px-2 py-1.5 text-right">{t.par}</td>
              <td />
              <td className="px-2 py-1.5 text-right">{t.strokes ?? '—'}</td>
              <td className="px-2 py-1.5 text-right">{t.putts}</td>
              <td className="px-2 py-1.5 text-right">{t.penalties || ''}</td>
              <td className="px-2 py-1.5 text-right">{t.net ?? '—'}</td>
              <td className="px-2 py-1.5 text-right">{t.points}</td>
              <td className="px-2 py-1.5 text-right">{sgText(t.sg)}</td>
            </tr>
          ))}
        </tfoot>
      </table>
    </div>
  );
}
