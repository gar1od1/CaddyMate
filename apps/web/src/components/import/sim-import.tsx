'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import type { Db } from '@caddymate/api';
import { createClient } from '@/lib/supabase/client';
import {
  aliasUpdates,
  initialMapping,
  suggestClub,
  toClubAliases,
  type AliasClub,
} from '@/lib/sim/aliases';
import { importSim, type ImportSimResponse } from '@/lib/sim/functions';
import { parseSimCsv, SIM_FIELDS, type SimFormat, type SimParseResult } from '@/lib/sim/parse';
import { yds } from '@/lib/review/format';

const FORMAT_LABEL: Record<SimFormat, string> = { gspro: 'GSPro', square: 'Square Golf' };
const UNIT_LABEL = { yd: 'yards', m: 'metres', ft: 'feet' } as const;
const SOURCE_LABEL = {
  header: 'from header',
  'units-row': 'from units row',
  'units-column': 'per row (units column)',
  cell: 'from cell suffix',
  default: 'assumed',
} as const;
const REASON_LABEL = {
  remembered: 'remembered',
  name: 'same name',
  matched: 'matched',
  loft: 'by loft',
} as const;

interface Loaded {
  name: string;
  text: string;
  parsed: SimParseResult;
}

/** Upload → preview → alias → import (docs/SPEC.md §12). The server re-parses the file. */
export function SimImport({ clubs }: { clubs: AliasClub[] }) {
  const router = useRouter();
  const [file, setFile] = useState<Loaded | null>(null);
  const [format, setFormat] = useState<SimFormat | ''>('');
  const [mapping, setMapping] = useState<Record<string, string | null>>({});
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportSimResponse | null>(null);
  const bag = useMemo(() => clubs.filter((c) => c.kind !== 'putter'), [clubs]);

  async function load(f: File) {
    setError(null);
    setResult(null);
    if (f.size > 20 * 1024 * 1024) {
      setError('That file is over 20 MB; export a smaller range of sessions.');
      return;
    }
    const text = await f.text();
    const parsed = parseSimCsv(text, f.name);
    setFile({ name: f.name, text, parsed });
    setFormat(parsed.format ?? '');
    setMapping(
      initialMapping(
        parsed.perClub.map((c) => c.club),
        bag,
      ),
    );
  }

  const p = file?.parsed ?? null;
  const mappedShots = p
    ? p.perClub.filter((c) => mapping[c.club]).reduce((t, c) => t + c.count, 0)
    : 0;
  const canImport = !!p && p.errors.length === 0 && format !== '' && mappedShots > 0 && !busy;

  async function submit() {
    if (!file || !canImport || !format) return;
    setBusy(true);
    setError(null);
    setResult(null);
    const client = createClient();
    const db = client as unknown as Db;
    try {
      // Remember the choices first so the next import (and the server) sees them.
      for (const u of aliasUpdates(clubs, mapping)) {
        const { error: e } = await db
          .from('clubs')
          .update({ sim_name_aliases: u.aliases })
          .eq('club_id', u.clubId);
        if (e) throw new Error(`Saving club aliases failed: ${e.message}`);
      }
      const r = await importSim(client, {
        source: format,
        csv: file.text,
        clubAliases: toClubAliases(mapping),
      });
      if (r.ok) {
        setResult(r.data);
        router.refresh();
      } else setError(r.message);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <label
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          const f = e.dataTransfer.files[0];
          if (f) void load(f);
        }}
        className={`card flex cursor-pointer flex-col items-center gap-2 border-2 border-dashed text-center ${
          dragging ? 'border-accent' : ''
        }`}
      >
        <span className="font-semibold">Drop a GSPro shot-history CSV or a Square Golf export</span>
        <span className="text-muted text-sm">or click to choose a file</span>
        {file ? <span className="text-sm">{file.name}</span> : null}
        <input
          type="file"
          accept=".csv,text/csv,text/plain"
          className="sr-only"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void load(f);
            e.target.value = '';
          }}
        />
      </label>

      {p ? (
        <section className="card space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-semibold">Preview</h2>
            <label className="flex items-center gap-2 text-sm">
              Simulator
              <select
                className="input w-auto py-1 text-sm"
                value={format}
                onChange={(e) => setFormat(e.target.value as SimFormat | '')}
              >
                <option value="">Choose…</option>
                <option value="gspro">GSPro</option>
                <option value="square">Square Golf</option>
              </select>
            </label>
          </div>
          <p className="text-muted text-sm">
            {p.format
              ? `Detected ${FORMAT_LABEL[p.format]} (${p.formatReason}).`
              : `Could not tell which simulator this is (${p.formatReason}) — choose it above.`}{' '}
            Header on line {p.headerRow || '—'}, delimiter{' '}
            {p.delimiter === '\t' ? 'tab' : `“${p.delimiter}”`}.
          </p>
          {p.errors.map((e) => (
            <p key={e} className="text-danger text-sm">
              {e}
            </p>
          ))}
          {p.errors.length === 0 ? (
            <>
              <table className="w-full text-sm">
                <thead className="text-muted text-xs uppercase">
                  <tr className="border-b border-border">
                    <th className="py-1.5 text-left font-medium">Field</th>
                    <th className="py-1.5 text-left font-medium">Column</th>
                    <th className="py-1.5 text-left font-medium">Units</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {SIM_FIELDS.map((f) => {
                    const c = p.columns[f];
                    const u = f === 'carry' || f === 'total' || f === 'offline' ? p.units[f] : null;
                    return (
                      <tr key={f}>
                        <td className="py-1.5 capitalize">{f}</td>
                        <td className={`py-1.5 ${c ? '' : 'text-muted'}`}>
                          {c ? `“${c.header}”` : 'not found'}
                        </td>
                        <td className="text-muted py-1.5">
                          {u ? `${UNIT_LABEL[u.unit]} (${SOURCE_LABEL[u.source]})` : ''}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <p className="text-sm">
                <strong>{p.shots.length}</strong> shots in {p.perClub.length} clubs
                {p.skipped.length ? `, ${String(p.skipped.length)} rows skipped` : ''}.
              </p>
              {p.skipped.length ? (
                <details className="text-muted text-xs">
                  <summary className="cursor-pointer">Skipped rows</summary>
                  <ul className="mt-1">
                    {p.skipped.slice(0, 50).map((s) => (
                      <li key={s.row}>
                        Line {s.row}: {s.reason}
                      </li>
                    ))}
                  </ul>
                </details>
              ) : null}
              {p.warnings.map((w) => (
                <p key={w} className="text-muted text-sm">
                  {w}
                </p>
              ))}
            </>
          ) : null}
        </section>
      ) : null}

      {p && p.errors.length === 0 ? (
        <section className="card space-y-3">
          <h2 className="text-lg font-semibold">Clubs</h2>
          <p className="text-muted text-sm">
            Map each simulator club to a club in your bag. Choices are remembered for the next
            import. Clubs set to “Skip” are not imported.
          </p>
          {bag.length === 0 ? (
            <p className="text-danger text-sm">Your bag is empty — set it up in the app first.</p>
          ) : null}
          <table className="w-full text-sm" style={{ fontVariantNumeric: 'tabular-nums' }}>
            <thead className="text-muted text-xs uppercase">
              <tr className="border-b border-border">
                <th className="py-1.5 text-left font-medium">Sim club</th>
                <th className="py-1.5 text-right font-medium">Shots</th>
                <th className="py-1.5 text-right font-medium">Avg total yds</th>
                <th className="py-1.5 pl-4 text-left font-medium">Bag club</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {p.perClub.map(({ club, count }) => {
                const totals = p.shots
                  .filter((s) => s.club === club)
                  .flatMap((s) => s.totalM ?? s.carryM ?? []);
                const avg = totals.length
                  ? totals.reduce((t, x) => t + x, 0) / totals.length
                  : null;
                const hint = suggestClub(club, bag);
                return (
                  <tr key={club}>
                    <td className="py-1.5">{club}</td>
                    <td className="py-1.5 text-right">{count}</td>
                    <td className="py-1.5 text-right">{yds(avg)}</td>
                    <td className="py-1.5 pl-4">
                      <select
                        className="input w-auto py-1 text-sm"
                        value={mapping[club] ?? ''}
                        onChange={(e) =>
                          setMapping((m) => ({ ...m, [club]: e.target.value || null }))
                        }
                        aria-label={`Bag club for ${club}`}
                      >
                        <option value="">Skip</option>
                        {bag.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                      {hint && hint.clubId === mapping[club] ? (
                        <span className="text-faint ml-2 text-xs">{REASON_LABEL[hint.reason]}</span>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="flex flex-wrap items-center gap-4">
            <button className="btn px-5 py-2" disabled={!canImport} onClick={() => void submit()}>
              {busy ? 'Importing…' : `Import ${String(mappedShots)} shots`}
            </button>
            {format === '' ? (
              <span className="text-muted text-sm">Choose the simulator first.</span>
            ) : null}
          </div>
          {error ? <p className="text-danger text-sm">{error}</p> : null}
          {result ? (
            <p className="text-sm">
              Imported <strong>{result.inserted}</strong> shots
              {result.skipped
                ? `, ${String(result.skipped)} skipped as duplicates or unmapped`
                : ''}
              ; refit{' '}
              {Array.isArray(result.clubsRefit) ? result.clubsRefit.length : result.clubsRefit} club
              patterns.
            </p>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
