'use client';

import Link from 'next/link';
import { useActionState, useState } from 'react';
import { LocationPicker, type Bounds, type LatLngValue } from '@/components/map/location-picker';
import { Input } from '@/components/primitives/Input';
import type { ImportResponse } from '@/lib/osm/import';
import { createCourseAction, type CreateState } from './actions';

type Area = 'view' | 'around' | 'file';

export function NewCourseForm() {
  const [state, formAction, pending] = useActionState<CreateState, FormData>(createCourseAction, {
    error: null,
  });
  const [name, setName] = useState('');
  const [country, setCountry] = useState('IE');
  const [lat, setLat] = useState('');
  const [lng, setLng] = useState('');
  const [bounds, setBounds] = useState<Bounds | null>(null);
  const [area, setArea] = useState<Area>('view');
  const [radiusM, setRadiusM] = useState('1200');
  const [file, setFile] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResponse | null>(null);

  const centre: LatLngValue | null =
    lat !== '' && lng !== '' && Number.isFinite(Number(lat)) && Number.isFinite(Number(lng))
      ? { lat: Number(lat), lng: Number(lng) }
      : null;

  async function runImport() {
    setImporting(true);
    setImportError(null);
    setResult(null);
    try {
      const body: Record<string, unknown> = { name: name.trim() || null, country };
      if (area === 'file') {
        if (!file) throw new Error('Choose an Overpass JSON file first.');
        body.overpass = JSON.parse(await file.text());
      } else if (area === 'around') {
        if (!centre) throw new Error('Pick the course centre on the map first.');
        body.area = { kind: 'around', lat: centre.lat, lng: centre.lng, radiusM: Number(radiusM) };
      } else {
        if (!bounds) throw new Error('The map has not loaded yet.');
        body.area = { kind: 'bbox', ...bounds };
      }
      const res = await fetch('/courses/import-osm', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = (await res.json()) as ImportResponse | { error: string };
      if (!res.ok || 'error' in json)
        throw new Error('error' in json ? json.error : `HTTP ${res.status}`);
      setResult(json);
    } catch (e) {
      setImportError(e instanceof Error ? e.message : String(e));
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_1.2fr]">
      <div className="space-y-6">
        <form action={formAction} className="card space-y-4">
          <h2 className="font-semibold">Details</h2>
          <Input
            label="Name"
            name="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Moyvalley Golf Club"
            required
          />
          <Input
            label="Country (2-letter code)"
            name="country"
            inputClassName="uppercase"
            maxLength={2}
            value={country}
            onChange={(e) => setCountry(e.target.value.toUpperCase())}
            required
          />
          <div className="grid-2">
            <Input
              label="Latitude"
              name="lat"
              inputMode="decimal"
              value={lat}
              onChange={(e) => setLat(e.target.value)}
              placeholder="53.4245"
              aria-describedby="centre-hint"
            />
            <Input
              label="Longitude"
              name="lng"
              inputMode="decimal"
              value={lng}
              onChange={(e) => setLng(e.target.value)}
              placeholder="-6.9165"
              aria-describedby="centre-hint"
            />
          </div>
          <p id="centre-hint" className="text-muted text-xs">
            Click the map to set the centre.
          </p>
          {state.error ? (
            <p className="text-danger text-sm" role="alert">
              {state.error}
            </p>
          ) : null}
          <button className="btn w-full" type="submit" disabled={pending || !name.trim()}>
            {pending ? 'Creating…' : 'Create empty course'}
          </button>
        </form>

        <section className="card space-y-4">
          <h2 className="font-semibold">Import from OpenStreetMap</h2>
          <p className="text-muted text-sm">
            Pulls <code>golf=*</code> holes, greens, tees, fairways, bunkers and water from OSM via
            Overpass into a new draft you can then fix up.
          </p>
          <fieldset className="space-y-2 text-sm">
            <legend className="sr-only">Area to import</legend>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="area"
                checked={area === 'view'}
                onChange={() => setArea('view')}
              />
              Visible map area
            </label>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="area"
                checked={area === 'around'}
                onChange={() => setArea('around')}
              />
              Around the centre
            </label>
            {area === 'around' ? (
              <Input
                className="pl-6"
                label="Radius (m)"
                inputClassName="max-w-[10rem]"
                inputMode="numeric"
                value={radiusM}
                onChange={(e) => setRadiusM(e.target.value)}
              />
            ) : null}
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="area"
                checked={area === 'file'}
                onChange={() => setArea('file')}
              />
              Overpass JSON file (e.g. exported from overpass-turbo with <code>out geom;</code>)
            </label>
            {area === 'file' ? (
              <input
                type="file"
                accept=".json,application/json"
                className="text-sm"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
            ) : null}
          </fieldset>
          {importError ? (
            <p className="text-danger text-sm" role="alert">
              {importError}
            </p>
          ) : null}
          <button
            type="button"
            className="btn w-full"
            disabled={importing}
            onClick={() => void runImport()}
          >
            {importing ? 'Importing…' : 'Import from OpenStreetMap'}
          </button>
          {result ? (
            <div className="space-y-2 rounded-xl border border-border p-3 text-sm">
              <p>
                Imported <strong>{result.name}</strong>: {result.stats.holes} holes,{' '}
                {result.stats.greens} greens, {result.stats.teeMarkers} tee markers,{' '}
                {result.stats.features} features.
              </p>
              {result.warnings.length > 0 ? (
                <ul className="text-muted list-disc space-y-0.5 pl-5">
                  {result.warnings.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              ) : null}
              <Link
                href={`/courses/${result.courseId}/edit`}
                className="btn inline-block px-4 py-2"
              >
                Open in editor
              </Link>
            </div>
          ) : null}
        </section>
      </div>

      <div className="card min-h-[480px] overflow-hidden !p-0 lg:sticky lg:top-[calc(var(--topbar-h)+1.5rem)] lg:h-[calc(100dvh-var(--topbar-h)-3rem)]">
        <LocationPicker
          className="h-full min-h-[480px] w-full"
          value={centre}
          onChange={(p) => {
            setLat(String(p.lat));
            setLng(String(p.lng));
          }}
          onBoundsChange={setBounds}
        />
      </div>
    </div>
  );
}
