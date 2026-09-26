'use client';

import { useState } from 'react';
import {
  findMarker,
  removeFeature,
  removeMarker,
  updateFeature,
  updateHole,
  updateMarker,
} from '@/lib/courses/doc';
import { formatYards, lineLengthM, markerYardageM } from '@/lib/courses/geometry';
import {
  FEATURE_KINDS,
  FEATURE_PENALTIES,
  isPointKind,
  type CourseDoc,
  type FeatureKind,
  type FeatureRow,
  type HoleRow,
} from '@/lib/courses/types';
import { Select } from '@/components/primitives/Select';
import { KIND_COLOURS } from './map-style';
import type { StartDraw } from './targets';

type Change = (fn: (doc: CourseDoc) => CourseDoc) => void;

const label = (s: string) => s.replace(/_/g, ' ');
const kindOptions = (kinds: readonly FeatureKind[]) =>
  kinds.map((k) => ({ value: k, label: label(k), hint: isPointKind(k) ? 'point' : 'area' }));

const intOrNull = (v: string): number | null => {
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
};
const numOrNull = (v: string): number | null => {
  const n = Number.parseFloat(v);
  return Number.isFinite(n) ? n : null;
};

interface HolePanelProps {
  doc: CourseDoc;
  hole: HoleRow;
  readOnly: boolean;
  selectedFeatureId: string | null;
  change: Change;
  startDraw: StartDraw;
  onSelectFeature: (id: string | null) => void;
  onDeleteHole: () => void;
}

export function HolePanel(props: HolePanelProps) {
  const { doc, hole, readOnly, change, startDraw } = props;
  const [newKind, setNewKind] = useState<FeatureKind>('bunker');
  const features = doc.features.filter((f) => f.hole_id === hole.hole_id);
  const lengthM = lineLengthM(hole.line_of_play);
  const set = (patch: Partial<HoleRow>) => change((d) => updateHole(d, hole.hole_id, patch));

  return (
    <div className="space-y-5">
      <section className="space-y-3">
        <div className="flex items-end gap-3">
          <label className="w-20">
            <span className="cm-label">Hole</span>
            <input
              className="cm-field"
              type="number"
              min={1}
              max={36}
              value={hole.hole_number}
              disabled={readOnly}
              onChange={(e) => {
                const n = intOrNull(e.target.value);
                if (n != null) set({ hole_number: n });
              }}
            />
          </label>
          <label className="w-20">
            <span className="cm-label">Par</span>
            <select
              className="cm-field"
              value={hole.par}
              disabled={readOnly}
              onChange={(e) => set({ par: Number(e.target.value) })}
            >
              {[3, 4, 5, 6].map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </label>
          <div className="flex-1 text-right">
            <span className="cm-label">Line of play</span>
            <span className="text-lg font-bold">{formatYards(lengthM)}</span>
          </div>
        </div>
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-semibold">Geometry</h3>
        <GeometryRow
          name="Line of play"
          present={!!hole.line_of_play}
          readOnly={readOnly}
          onDraw={() => startDraw({ t: 'line', holeId: hole.hole_id }, { fresh: true })}
          onEdit={() => startDraw({ t: 'line', holeId: hole.hole_id })}
          onClear={() => set({ line_of_play: null })}
        />
        <GeometryRow
          name="Green"
          present={!!hole.green_polygon}
          readOnly={readOnly}
          onDraw={() => startDraw({ t: 'green', holeId: hole.hole_id }, { fresh: true })}
          onEdit={() => startDraw({ t: 'green', holeId: hole.hole_id })}
          onClear={() => set({ green_polygon: null })}
        />
        <GeometryRow
          name="Green centre"
          present={!!hole.green_centre}
          readOnly={readOnly}
          onDraw={() => startDraw({ t: 'greenCentre', holeId: hole.hole_id })}
          onClear={() => set({ green_centre: null })}
        />
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-semibold">Tees</h3>
        {doc.tee_sets.length === 0 ? (
          <p className="text-muted text-sm">Add a tee set first (Tee sets tab).</p>
        ) : null}
        {doc.tee_sets.map((t) => {
          const marker = findMarker(doc, t.tee_set_id, hole.hole_id);
          const yards = marker ? markerYardageM(marker, hole) : null;
          return (
            <div key={t.tee_set_id} className="flex items-center gap-2 text-sm">
              <span
                className="h-3 w-3 shrink-0 rounded-full border border-black/40"
                style={{ background: t.colour_hex ?? '#fff' }}
              />
              <span className="w-20 truncate">{t.name}</span>
              <span className="w-20 font-semibold whitespace-nowrap">
                {marker ? formatYards(yards) : '—'}
              </span>
              <label className="flex items-center gap-1">
                <span className="text-muted text-xs">SI</span>
                <input
                  className="cm-field w-14"
                  type="number"
                  min={1}
                  max={18}
                  disabled={readOnly || !marker}
                  title={marker ? 'Stroke index' : 'Place the marker first'}
                  value={marker?.stroke_index ?? ''}
                  onChange={(e) =>
                    marker &&
                    change((d) =>
                      updateMarker(d, marker.tee_id, { stroke_index: intOrNull(e.target.value) }),
                    )
                  }
                />
              </label>
              {!readOnly ? (
                <span className="ml-auto flex gap-1">
                  <button
                    type="button"
                    className="cm-btn-sm"
                    onClick={() =>
                      startDraw({ t: 'tee', holeId: hole.hole_id, teeSetId: t.tee_set_id })
                    }
                  >
                    {marker ? 'Move' : 'Place'}
                  </button>
                  {marker ? (
                    <button
                      type="button"
                      className="cm-btn-sm cm-btn-danger"
                      aria-label={`Remove ${t.name} marker`}
                      onClick={() => change((d) => removeMarker(d, marker.tee_id))}
                    >
                      ✕
                    </button>
                  ) : null}
                </span>
              ) : null}
            </div>
          );
        })}
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-semibold">Features ({features.length})</h3>
        {features.map((f) => (
          <FeatureEditor
            key={f.feature_id}
            doc={doc}
            feature={f}
            readOnly={readOnly}
            selected={f.feature_id === props.selectedFeatureId}
            change={change}
            startDraw={startDraw}
            onSelect={() => props.onSelectFeature(f.feature_id)}
          />
        ))}
        {!readOnly ? (
          <div className="flex gap-2 pt-1">
            <Select
              size="sm"
              className="min-w-0 flex-1"
              aria-label="New feature kind"
              options={kindOptions(FEATURE_KINDS)}
              value={newKind}
              onChange={(v) => setNewKind(v as FeatureKind)}
            />
            <button
              type="button"
              className="cm-btn-sm"
              onClick={() => startDraw({ t: 'newFeature', holeId: hole.hole_id, kind: newKind })}
            >
              + Draw {isPointKind(newKind) ? 'point' : 'polygon'}
            </button>
          </div>
        ) : null}
      </section>

      {!readOnly ? (
        <button type="button" className="cm-btn-sm cm-btn-danger" onClick={props.onDeleteHole}>
          Delete hole {hole.hole_number}
        </button>
      ) : null}
    </div>
  );
}

function GeometryRow(props: {
  name: string;
  present: boolean;
  readOnly: boolean;
  onDraw: () => void;
  onEdit?: () => void;
  onClear: () => void;
}) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <span className={props.present ? 'text-accent' : 'text-faint'}>
        {props.present ? '●' : '○'}
      </span>
      <span className="flex-1">{props.name}</span>
      {!props.readOnly ? (
        <>
          {props.present && props.onEdit ? (
            <button type="button" className="cm-btn-sm" onClick={props.onEdit}>
              Edit
            </button>
          ) : null}
          <button type="button" className="cm-btn-sm" onClick={props.onDraw}>
            {props.present ? (props.onEdit ? 'Redraw' : 'Move') : props.onEdit ? 'Draw' : 'Place'}
          </button>
          {props.present ? (
            <button
              type="button"
              className="cm-btn-sm cm-btn-danger"
              aria-label={`Clear ${props.name}`}
              onClick={props.onClear}
            >
              ✕
            </button>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function FeatureEditor(props: {
  doc: CourseDoc;
  feature: FeatureRow;
  readOnly: boolean;
  selected: boolean;
  change: Change;
  startDraw: StartDraw;
  onSelect: () => void;
}) {
  const { feature: f, readOnly, change } = props;
  const set = (patch: Partial<FeatureRow>) => change((d) => updateFeature(d, f.feature_id, patch));
  const point = isPointKind(f.kind);
  return (
    <div
      className={`space-y-2 rounded-lg border p-2 ${props.selected ? 'border-accent' : 'border-border'}`}
      onClick={props.onSelect}
    >
      <div className="flex items-center gap-2">
        <span
          className="h-3 w-3 shrink-0 rounded-sm"
          style={{ background: KIND_COLOURS[f.kind] }}
        />
        <Select
          size="sm"
          className="min-w-0 flex-1"
          aria-label="Kind"
          disabled={readOnly}
          // Point ↔ polygon kinds need a different geometry; keep the kind change within its shape.
          options={kindOptions(FEATURE_KINDS.filter((k) => isPointKind(k) === point))}
          value={f.kind}
          onChange={(v) => set({ kind: v as FeatureKind })}
        />
        <select
          className="cm-field w-24"
          value={f.penalty}
          disabled={readOnly}
          aria-label="Penalty"
          onChange={(e) => set({ penalty: e.target.value as FeatureRow['penalty'] })}
        >
          {FEATURE_PENALTIES.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
      </div>
      {props.selected ? (
        <div className="space-y-2">
          {point ? (
            <div className="flex gap-2">
              <label className="flex-1">
                <span className="cm-label">Radius (m)</span>
                <input
                  className="cm-field"
                  type="number"
                  step="0.5"
                  disabled={readOnly}
                  value={f.tree_radius_m ?? ''}
                  onChange={(e) => set({ tree_radius_m: numOrNull(e.target.value) })}
                />
              </label>
              <label className="flex-1">
                <span className="cm-label">Height (m)</span>
                <input
                  className="cm-field"
                  type="number"
                  step="0.5"
                  disabled={readOnly}
                  value={f.tree_height_m ?? ''}
                  onChange={(e) => set({ tree_height_m: numOrNull(e.target.value) })}
                />
              </label>
            </div>
          ) : null}
          <div>
            <span className="cm-label" id={`hole-of-${f.feature_id}`}>
              Hole
            </span>
            <Select
              size="sm"
              className="w-full"
              aria-labelledby={`hole-of-${f.feature_id}`}
              disabled={readOnly}
              options={props.doc.holes.map((h) => ({
                value: h.hole_id,
                label: `Hole ${String(h.hole_number)}`,
                hint: `par ${String(h.par)}`,
              }))}
              value={f.hole_id}
              onChange={(v) => set({ hole_id: v })}
            />
          </div>
          <input
            className="cm-field"
            placeholder="Notes"
            disabled={readOnly}
            value={f.notes ?? ''}
            onChange={(e) => set({ notes: e.target.value || null })}
          />
          {!readOnly ? (
            <div className="flex gap-2">
              <button
                type="button"
                className="cm-btn-sm"
                onClick={() => props.startDraw({ t: 'feature', featureId: f.feature_id })}
              >
                {point ? 'Move' : 'Edit shape'}
              </button>
              <button
                type="button"
                className="cm-btn-sm cm-btn-danger"
                onClick={() => change((d) => removeFeature(d, f.feature_id))}
              >
                Delete
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
