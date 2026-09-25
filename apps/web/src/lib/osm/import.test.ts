import { describe, expect, it, vi } from 'vitest';
import type { Db } from '@/lib/courses/repo';
import fixture from './__fixtures__/overpass-sample.json';
import { ImportError, importOsmCourse } from './import';
import type { OverpassClient, OverpassResponse } from './overpass';

const response = fixture as unknown as OverpassResponse;

function fakeDb(opts: { failSave?: boolean } = {}) {
  const rpc = vi.fn(async (fn: string, args: Record<string, unknown>) => {
    if (fn === 'course_create') return { data: 'course-1', error: null };
    if (fn === 'course_save_draft') {
      return opts.failSave
        ? { data: null, error: { message: 'boom' } }
        : { data: null, error: null };
    }
    throw new Error(`unexpected rpc ${fn} ${JSON.stringify(args)}`);
  });
  const eq = vi.fn(async () => ({ error: null }));
  const from = vi.fn(() => ({ delete: () => ({ eq }) }));
  return { db: { rpc, from } as unknown as Db, rpc, eq };
}

const okClient = (): OverpassClient & { query: ReturnType<typeof vi.fn> } => ({
  query: vi.fn(async () => response),
});

describe('importOsmCourse', () => {
  it('queries Overpass, creates an osm course and saves the mapped draft', async () => {
    const { db, rpc } = fakeDb();
    const client = okClient();
    const out = await importOsmCourse(db, client, {
      area: { kind: 'around', lat: 53.422, lng: -6.9175, radiusM: 1000 },
      country: 'ie',
    });
    expect(client.query).toHaveBeenCalledOnce();
    expect(String(client.query.mock.calls[0]![0])).toContain('(around:1000,53.422,-6.9175)');
    expect(out).toMatchObject({ courseId: 'course-1', name: 'Test Golf Club' });
    expect(out.stats.holes).toBe(3);
    const [, createArgs] = rpc.mock.calls[0]!;
    expect(createArgs).toMatchObject({
      p_name: 'Test Golf Club',
      p_country: 'IE',
      p_source: 'osm',
      p_osm_relation_id: 'way/7001',
    });
    const [fn, saveArgs] = rpc.mock.calls[1]!;
    expect(fn).toBe('course_save_draft');
    expect((saveArgs.p_doc as { holes: unknown[] }).holes).toHaveLength(3);
  });

  it('accepts an uploaded Overpass response and a name override', async () => {
    const { db } = fakeDb();
    const client = okClient();
    const out = await importOsmCourse(db, client, {
      overpass: response,
      country: 'IE',
      name: 'Moyvalley',
    });
    expect(client.query).not.toHaveBeenCalled();
    expect(out.name).toBe('Moyvalley');
  });

  it('reports Overpass failures as 502', async () => {
    const { db } = fakeDb();
    const client: OverpassClient = {
      query: async () => {
        throw new Error('ECONNREFUSED');
      },
    };
    const err = await importOsmCourse(db, client, {
      area: { kind: 'bbox', south: 53.41, west: -6.93, north: 53.43, east: -6.9 },
      country: 'IE',
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ImportError);
    expect((err as ImportError).status).toBe(502);
  });

  it('validates input', async () => {
    const { db } = fakeDb();
    await expect(importOsmCourse(db, okClient(), { country: 'IE' })).rejects.toMatchObject({
      status: 400,
    });
    await expect(
      importOsmCourse(db, okClient(), { overpass: response, country: 'Ireland' }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      importOsmCourse(db, okClient(), { overpass: { elements: [] }, country: 'IE' }),
    ).rejects.toMatchObject({ status: 422 });
  });

  it('deletes the new course if saving the draft fails', async () => {
    const { db, eq } = fakeDb({ failSave: true });
    await expect(
      importOsmCourse(db, okClient(), { overpass: response, country: 'IE' }),
    ).rejects.toThrow('boom');
    expect(eq).toHaveBeenCalledWith('course_id', 'course-1');
  });
});
