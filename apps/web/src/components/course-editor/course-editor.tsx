'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Geometry, LineString, Point, Polygon } from 'geojson';
import { createClient } from '@/lib/supabase/client';
import {
  addFeature,
  addHole,
  placeTeeMarker,
  removeHole,
  setGreenPolygon,
  setLineOfPlay,
  updateFeature,
  updateHole,
  validateDoc,
  withYardages,
} from '@/lib/courses/doc';
import { publishCourse, saveDraft, type Db } from '@/lib/courses/repo';
import { isPointKind, type CourseDoc, type CourseVersionDoc } from '@/lib/courses/types';
import { EditorMap, type DrawSession, type EditorMapHandle } from './editor-map';
import { HolePanel } from './hole-panel';
import type { HiddenKey } from './map-style';
import { EDIT_PROMPT, PROMPTS, type DrawTarget, type StartDraw } from './targets';
import { TeeSetsPanel } from './tee-sets-panel';

type Tab = 'holes' | 'tees' | 'course' | 'issues';

interface Meta {
  name: string;
  country: string;
  centroid: Point;
}

const newId = () => crypto.randomUUID();

interface Props {
  initial: CourseVersionDoc;
  /** Viewer mode: published version, no editing. */
  readOnly?: boolean;
}

export function CourseEditor({ initial, readOnly = false }: Props) {
  const router = useRouter();
  const mapRef = useRef<EditorMapHandle>(null);
  const [doc, setDoc] = useState<CourseDoc>(() => ({
    holes: initial.holes,
    features: initial.features,
    tee_sets: initial.tee_sets,
    tee_markers: initial.tee_markers,
  }));
  const [meta, setMeta] = useState<Meta>({
    name: initial.course.name,
    country: initial.course.country,
    centroid: initial.course.centroid,
  });
  const [course, setCourse] = useState(initial.course);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState<'saving' | 'publishing' | null>(null);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [tab, setTab] = useState<Tab>('holes');
  const [selectedHoleId, setSelectedHoleId] = useState<string | null>(
    initial.holes[0]?.hole_id ?? null,
  );
  const [selectedFeatureId, setSelectedFeatureId] = useState<string | null>(null);
  const [active, setActive] = useState<{
    target: DrawTarget;
    session: DrawSession;
    hidden: HiddenKey;
  } | null>(null);

  const issues = useMemo(() => validateDoc(doc), [doc]);
  const errors = issues.filter((i) => i.level === 'error');
  const hole = doc.holes.find((h) => h.hole_id === selectedHoleId) ?? null;

  const change = useCallback((fn: (d: CourseDoc) => CourseDoc) => {
    setDoc((d) => fn(d));
    setDirty(true);
    setMessage(null);
  }, []);

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  // ---- drawing -------------------------------------------------------------
  const startDraw: StartDraw = (target, opts = {}) => {
    const fresh = opts.fresh ?? false;
    let session: DrawSession;
    let hidden: HiddenKey = null;
    switch (target.t) {
      case 'line': {
        const line = doc.holes.find((h) => h.hole_id === target.holeId)?.line_of_play;
        session = line && !fresh ? { mode: 'edit', geometry: line } : { mode: 'line' };
        hidden = `line:${target.holeId}`;
        break;
      }
      case 'green': {
        const poly = doc.holes.find((h) => h.hole_id === target.holeId)?.green_polygon;
        session = poly && !fresh ? { mode: 'edit', geometry: poly } : { mode: 'polygon' };
        hidden = `green:${target.holeId}`;
        break;
      }
      case 'feature': {
        const f = doc.features.find((x) => x.feature_id === target.featureId);
        if (!f) return;
        session =
          f.polygon && !isPointKind(f.kind)
            ? { mode: 'edit', geometry: f.polygon }
            : { mode: 'point' };
        hidden = `feature:${f.feature_id}`;
        break;
      }
      case 'newFeature':
        session = { mode: isPointKind(target.kind) ? 'point' : 'polygon' };
        break;
      default:
        session = { mode: 'point' };
    }
    setMessage(null);
    setActive({ target, session, hidden });
  };

  const apply = (target: DrawTarget, g: Geometry) => {
    const asPoint = g.type === 'Point' ? (g as Point) : null;
    const asLine = g.type === 'LineString' ? (g as LineString) : null;
    const asPoly = g.type === 'Polygon' ? (g as Polygon) : null;
    switch (target.t) {
      case 'line':
        if (asLine && asLine.coordinates.length >= 2)
          change((d) => setLineOfPlay(d, target.holeId, asLine));
        break;
      case 'green':
        if (asPoly) change((d) => setGreenPolygon(d, target.holeId, asPoly));
        break;
      case 'greenCentre':
        if (asPoint) change((d) => updateHole(d, target.holeId, { green_centre: asPoint }));
        break;
      case 'tee':
        if (asPoint)
          change((d) => placeTeeMarker(d, newId, target.teeSetId, target.holeId, asPoint));
        break;
      case 'newFeature': {
        const geom = isPointKind(target.kind) ? asPoint : asPoly;
        if (!geom) break;
        const id = newId();
        change((d) => addFeature(d, () => id, target.holeId, target.kind, geom).doc);
        setSelectedFeatureId(id);
        break;
      }
      case 'feature':
        if (asPoint) change((d) => updateFeature(d, target.featureId, { point: asPoint }));
        if (asPoly) change((d) => updateFeature(d, target.featureId, { polygon: asPoly }));
        break;
      case 'courseCentre':
        if (asPoint) {
          setMeta((m) => ({ ...m, centroid: asPoint }));
          setDirty(true);
        }
        break;
    }
  };

  const onDrawn = (g: Geometry) => {
    if (active) apply(active.target, g);
    setActive(null);
  };

  const finishEdit = () => {
    const g = mapRef.current?.finishEdit();
    if (active && g) apply(active.target, g);
    setActive(null);
  };

  // ---- persistence -----------------------------------------------------------
  const db = () => createClient() as unknown as Db;

  const save = async (): Promise<boolean> => {
    if (errors.length > 0) {
      setMessage({ kind: 'error', text: errors[0]!.message });
      setTab('issues');
      return false;
    }
    setBusy('saving');
    try {
      const measured = withYardages(doc);
      await saveDraft(db(), course.course_id, measured, meta);
      setDoc(measured);
      setCourse((c) => ({ ...c, name: meta.name, country: meta.country, centroid: meta.centroid }));
      setDirty(false);
      setMessage({ kind: 'ok', text: 'Draft saved.' });
      return true;
    } catch (e) {
      setMessage({ kind: 'error', text: e instanceof Error ? e.message : String(e) });
      return false;
    } finally {
      setBusy(null);
    }
  };

  const publish = async () => {
    const reason = window.prompt(
      `Publish a new version of ${meta.name}? Rounds already played keep the version they used.\n\nChange note (optional):`,
      course.current_version === 0 ? 'Initial version' : '',
    );
    if (reason === null) return;
    if (dirty && !(await save())) return;
    setBusy('publishing');
    try {
      const version = await publishCourse(db(), course.course_id, reason);
      setCourse((c) => ({ ...c, current_version: version, status: 'published' }));
      setMessage({ kind: 'ok', text: `Published version ${version}.` });
      router.refresh();
    } catch (e) {
      setMessage({ kind: 'error', text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(null);
    }
  };

  const selectHole = (id: string) => {
    setSelectedHoleId(id);
    setSelectedFeatureId(null);
    setTab('holes');
    mapRef.current?.focusHole(id);
  };

  const canWrite = !readOnly && course.can_write;
  const drawing = active !== null;

  return (
    <div className="flex h-dvh flex-col">
      <header className="flex items-center gap-3 border-b border-border bg-bg-elevated px-4 py-2">
        <Link href="/courses" className="link text-sm">
          ← Courses
        </Link>
        <h1 className="truncate text-lg font-bold">{meta.name}</h1>
        <span className="rounded-full border border-border px-2 py-0.5 text-xs text-muted">
          {readOnly
            ? `v${initial.version}`
            : course.status === 'published'
              ? `draft · published v${course.current_version}`
              : 'draft · never published'}
        </span>
        {dirty ? <span className="text-xs text-muted">Unsaved changes</span> : null}
        <div className="ml-auto flex items-center gap-2">
          {message ? (
            <span className={`text-sm ${message.kind === 'error' ? 'text-danger' : 'text-accent'}`}>
              {message.text}
            </span>
          ) : null}
          {readOnly && course.can_write ? (
            <Link href={`/courses/${course.course_id}/edit`} className="btn px-4 py-2 text-sm">
              Edit
            </Link>
          ) : null}
          {canWrite ? (
            <>
              <button
                type="button"
                className="cm-btn-sm px-4 py-2"
                disabled={!dirty || busy !== null || drawing}
                onClick={() => void save()}
              >
                {busy === 'saving' ? 'Saving…' : 'Save draft'}
              </button>
              <button
                type="button"
                className="btn px-4 py-2 text-sm"
                disabled={busy !== null || drawing || errors.length > 0 || doc.holes.length === 0}
                onClick={() => void publish()}
              >
                {busy === 'publishing' ? 'Publishing…' : 'Publish'}
              </button>
            </>
          ) : null}
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <aside className="flex w-[380px] shrink-0 flex-col border-r border-border bg-bg">
          <nav className="flex border-b border-border text-sm">
            {(
              [
                ['holes', `Holes (${doc.holes.length})`],
                ['tees', `Tee sets (${doc.tee_sets.length})`],
                ['course', 'Course'],
                ['issues', `Issues (${issues.length})`],
              ] as const
            ).map(([id, text]) => (
              <button
                key={id}
                type="button"
                className={`flex-1 px-2 py-2.5 ${tab === id ? 'border-b-2 border-accent font-semibold' : 'text-muted'}`}
                onClick={() => setTab(id)}
              >
                {text}
              </button>
            ))}
          </nav>

          <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto p-4">
            <fieldset disabled={drawing} className="min-w-0 space-y-4">
              {tab === 'holes' ? (
                <>
                  <div className="flex flex-wrap gap-1.5">
                    {doc.holes.map((h) => (
                      <button
                        key={h.hole_id}
                        type="button"
                        className={`h-9 w-9 rounded-lg text-sm font-bold ${
                          h.hole_id === selectedHoleId
                            ? 'bg-accent text-accent-text'
                            : 'border border-border bg-surface'
                        }`}
                        onClick={() => selectHole(h.hole_id)}
                      >
                        {h.hole_number}
                      </button>
                    ))}
                    {canWrite ? (
                      <button
                        type="button"
                        className="h-9 rounded-lg border border-dashed border-border px-3 text-sm text-muted"
                        onClick={() => {
                          const id = newId();
                          change((d) => addHole(d, () => id).doc);
                          setSelectedHoleId(id);
                          setSelectedFeatureId(null);
                        }}
                      >
                        + Hole
                      </button>
                    ) : null}
                  </div>
                  {hole ? (
                    <div className="card !p-4">
                      <HolePanel
                        doc={doc}
                        hole={hole}
                        readOnly={!canWrite}
                        selectedFeatureId={selectedFeatureId}
                        change={change}
                        startDraw={startDraw}
                        onSelectFeature={setSelectedFeatureId}
                        onDeleteHole={() => {
                          if (!window.confirm(`Delete hole ${hole.hole_number} and its features?`))
                            return;
                          change((d) => removeHole(d, hole.hole_id));
                          setSelectedHoleId(null);
                        }}
                      />
                    </div>
                  ) : (
                    <p className="text-muted text-sm">
                      {doc.holes.length === 0
                        ? 'No holes yet. Add one, then draw its line of play and green.'
                        : 'Select a hole.'}
                    </p>
                  )}
                </>
              ) : null}

              {tab === 'tees' ? (
                <TeeSetsPanel doc={doc} readOnly={!canWrite} change={change} newId={newId} />
              ) : null}

              {tab === 'course' ? (
                <div className="space-y-3">
                  <label className="block">
                    <span className="cm-label">Name</span>
                    <input
                      className="cm-field"
                      disabled={!canWrite}
                      value={meta.name}
                      onChange={(e) => {
                        setMeta((m) => ({ ...m, name: e.target.value }));
                        setDirty(true);
                      }}
                    />
                  </label>
                  <label className="block">
                    <span className="cm-label">Country (ISO 3166-1 alpha-2)</span>
                    <input
                      className="cm-field uppercase"
                      maxLength={2}
                      disabled={!canWrite}
                      value={meta.country}
                      onChange={(e) => {
                        setMeta((m) => ({ ...m, country: e.target.value.toUpperCase() }));
                        setDirty(true);
                      }}
                    />
                  </label>
                  <div className="flex items-center gap-2 text-sm">
                    <span className="flex-1 text-muted">
                      Centre {meta.centroid.coordinates[1]!.toFixed(5)},{' '}
                      {meta.centroid.coordinates[0]!.toFixed(5)}
                    </span>
                    {canWrite ? (
                      <button
                        type="button"
                        className="cm-btn-sm"
                        onClick={() => startDraw({ t: 'courseCentre' })}
                      >
                        Move
                      </button>
                    ) : null}
                  </div>
                  <dl className="text-muted grid grid-cols-2 gap-1 text-sm">
                    <dt>Source</dt>
                    <dd>{course.source}</dd>
                    {course.osm_relation_id ? (
                      <>
                        <dt>OSM</dt>
                        <dd>{course.osm_relation_id}</dd>
                      </>
                    ) : null}
                    <dt>Published version</dt>
                    <dd>{course.current_version || '—'}</dd>
                  </dl>
                  {course.current_version > 0 && !readOnly ? (
                    <Link href={`/courses/${course.course_id}`} className="link text-sm">
                      View published version
                    </Link>
                  ) : null}
                  <button
                    type="button"
                    className="cm-btn-sm"
                    onClick={() => mapRef.current?.fitAll()}
                  >
                    Zoom to course
                  </button>
                </div>
              ) : null}

              {tab === 'issues' ? (
                issues.length === 0 ? (
                  <p className="text-muted text-sm">No issues.</p>
                ) : (
                  <ul className="space-y-1.5 text-sm">
                    {issues.map((i, n) => (
                      <li key={n} className={i.level === 'error' ? 'text-danger' : 'text-muted'}>
                        {i.level === 'error' ? '✖' : '•'} {i.message}
                      </li>
                    ))}
                  </ul>
                )
              ) : null}
            </fieldset>
          </div>
        </aside>

        <main className="relative min-w-0 flex-1">
          <EditorMap
            ref={mapRef}
            className="absolute inset-0"
            doc={doc}
            centre={{ lat: meta.centroid.coordinates[1]!, lng: meta.centroid.coordinates[0]! }}
            boundary={course.boundary_polygon}
            selectedHoleId={selectedHoleId}
            selectedFeatureId={selectedFeatureId}
            hidden={active?.hidden ?? null}
            session={active?.session ?? null}
            onDrawn={onDrawn}
            onDrawCancelled={() => setActive(null)}
            onSelectHole={selectHole}
            onSelectFeature={(featureId, holeId) => {
              setSelectedHoleId(holeId);
              setSelectedFeatureId(featureId);
              setTab('holes');
            }}
          />
          {active ? (
            <div className="card absolute top-3 left-1/2 z-10 flex w-[min(640px,90%)] -translate-x-1/2 items-center gap-3 !p-3 shadow-xl">
              <p className="flex-1 text-sm">
                {active.session.mode === 'edit' ? EDIT_PROMPT : PROMPTS[active.target.t]}
              </p>
              {active.session.mode === 'edit' ? (
                <>
                  <button
                    type="button"
                    className="cm-btn-sm"
                    onClick={() => mapRef.current?.trash()}
                  >
                    Delete vertex
                  </button>
                  <button type="button" className="btn px-3 py-1.5 text-sm" onClick={finishEdit}>
                    Done
                  </button>
                </>
              ) : null}
              <button type="button" className="cm-btn-sm" onClick={() => setActive(null)}>
                Cancel
              </button>
            </div>
          ) : null}
        </main>
      </div>
    </div>
  );
}
