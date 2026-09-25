'use client';

import { addTeeSet, removeTeeSet, updateTeeSet, type NewId } from '@/lib/courses/doc';
import { formatYards, markerYardageM } from '@/lib/courses/geometry';
import type { CourseDoc, TeeSetRow } from '@/lib/courses/types';

type Change = (fn: (doc: CourseDoc) => CourseDoc) => void;

const numOrNull = (v: string): number | null => {
  const n = Number.parseFloat(v);
  return Number.isFinite(n) ? n : null;
};

const PRESETS: { name: string; colour_hex: string }[] = [
  { name: 'White', colour_hex: '#ffffff' },
  { name: 'Yellow', colour_hex: '#facc15' },
  { name: 'Blue', colour_hex: '#3b82f6' },
  { name: 'Red', colour_hex: '#ef4444' },
  { name: 'Black', colour_hex: '#111827' },
  { name: 'Green', colour_hex: '#22c55e' },
];

export function TeeSetsPanel(props: {
  doc: CourseDoc;
  readOnly: boolean;
  change: Change;
  newId: NewId;
}) {
  const { doc, readOnly, change, newId } = props;
  const nextPreset = PRESETS.find((p) => !doc.tee_sets.some((t) => t.name === p.name)) ?? {
    name: 'Tee',
    colour_hex: '#ffffff',
  };

  return (
    <div className="space-y-4">
      {doc.tee_sets.length === 0 ? (
        <p className="text-muted text-sm">
          A tee set is a set of markers with its own rating (White, Yellow, …). Rounds pick one.
        </p>
      ) : null}
      {doc.tee_sets.map((t) => (
        <TeeSetEditor
          key={t.tee_set_id}
          doc={doc}
          teeSet={t}
          readOnly={readOnly}
          onChange={(patch) => change((d) => updateTeeSet(d, t.tee_set_id, patch))}
          onDelete={() => change((d) => removeTeeSet(d, t.tee_set_id))}
        />
      ))}
      {!readOnly ? (
        <button
          type="button"
          className="cm-btn-sm"
          onClick={() => change((d) => addTeeSet(d, newId, nextPreset).doc)}
        >
          + Add tee set
        </button>
      ) : null}
    </div>
  );
}

function TeeSetEditor(props: {
  doc: CourseDoc;
  teeSet: TeeSetRow;
  readOnly: boolean;
  onChange: (patch: Partial<TeeSetRow>) => void;
  onDelete: () => void;
}) {
  const { doc, teeSet: t, readOnly, onChange } = props;
  const markers = doc.tee_markers.filter((m) => m.tee_set_id === t.tee_set_id);
  const holes = new Map(doc.holes.map((h) => [h.hole_id, h]));
  const totalM = markers.reduce((s, m) => s + (markerYardageM(m, holes.get(m.hole_id)) ?? 0), 0);
  const holePar = doc.holes.reduce((s, h) => s + h.par, 0);

  const num = (
    key: 'course_rating' | 'slope_rating' | 'bogey_rating' | 'par',
    text: string,
    step = '1',
  ) => (
    <label className="flex-1">
      <span className="cm-label">{text}</span>
      <input
        className="cm-field"
        type="number"
        step={step}
        disabled={readOnly}
        value={t[key] ?? ''}
        onChange={(e) => onChange({ [key]: numOrNull(e.target.value) })}
      />
    </label>
  );

  return (
    <div className="space-y-3 rounded-xl border border-border p-3">
      <div className="flex items-end gap-2">
        <label className="flex-1">
          <span className="cm-label">Name</span>
          <input
            className="cm-field"
            disabled={readOnly}
            value={t.name}
            onChange={(e) => onChange({ name: e.target.value })}
          />
        </label>
        <label>
          <span className="cm-label">Colour</span>
          <input
            className="h-[34px] w-12 cursor-pointer rounded-md border border-border bg-transparent"
            type="color"
            disabled={readOnly}
            value={t.colour_hex ?? '#ffffff'}
            onChange={(e) => onChange({ colour_hex: e.target.value })}
          />
        </label>
      </div>
      <div className="flex gap-2">
        {num('course_rating', 'Course rating', '0.1')}
        {num('slope_rating', 'Slope')}
        {num('bogey_rating', 'Bogey rating', '0.1')}
        {num('par', 'Par')}
      </div>
      <div className="text-muted flex items-center justify-between text-xs">
        <span>
          {markers.length}/{doc.holes.length} markers · {formatYards(totalM || null)}
          {t.par != null && holePar > 0 && t.par !== holePar
            ? ` · holes add to par ${holePar}`
            : ''}
        </span>
        {!readOnly ? (
          <button type="button" className="cm-btn-sm cm-btn-danger" onClick={props.onDelete}>
            Delete
          </button>
        ) : null}
      </div>
    </div>
  );
}
