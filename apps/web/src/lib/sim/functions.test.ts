import { describe, expect, it, vi } from 'vitest';
import {
  FunctionsFetchError,
  FunctionsHttpError,
  FunctionsRelayError,
  type SupabaseClient,
} from '@supabase/supabase-js';
import { describeFunctionError, importSim, refitClubs } from './functions';

const http = (status: number, body: string) =>
  new FunctionsHttpError(new Response(body, { status }));

describe('describeFunctionError', () => {
  it('explains unreachable, relay, missing and failing functions', async () => {
    expect(await describeFunctionError('import-sim', new FunctionsFetchError({}))).toMatch(
      /Could not reach the import-sim service/,
    );
    expect(await describeFunctionError('refit', new FunctionsRelayError({}))).toMatch(/relay/);
    expect(await describeFunctionError('import-sim', http(404, 'Not found'))).toBe(
      'The import-sim function is not deployed on this Supabase project yet.',
    );
    expect(await describeFunctionError('x', http(401, ''))).toMatch(/Sign in again/);
    expect(await describeFunctionError('import-sim', http(400, '{"error":"no rows"}'))).toBe(
      'import-sim failed (HTTP 400): no rows',
    );
    expect(await describeFunctionError('import-sim', http(500, 'boom'))).toBe(
      'import-sim failed (HTTP 500): boom',
    );
    expect(await describeFunctionError('x', new Error('bad'))).toBe('x failed: bad');
    expect(await describeFunctionError('x', 'weird')).toBe('x failed.');
  });
});

describe('invoke wrappers', () => {
  const client = (impl: (name: string, opts: unknown) => Promise<unknown>) => {
    const invoke = vi.fn(impl);
    return { c: { functions: { invoke } } as unknown as SupabaseClient, invoke };
  };

  it('posts the import payload and returns the result', async () => {
    const result = { sessionId: 's', inserted: 3, skipped: 1, clubsRefit: 2 };
    const { c, invoke } = client(async () => ({ data: result, error: null }));
    const req = { source: 'gspro' as const, csv: 'a', clubAliases: { Driver: 'd' } };
    expect(await importSim(c, req)).toEqual({ ok: true, data: result });
    expect(invoke).toHaveBeenCalledWith('import-sim', { body: req });
  });

  it('maps returned and thrown errors', async () => {
    const { c } = client(async () => ({ data: null, error: http(404, '') }));
    expect(await refitClubs(c, ['a'])).toEqual({
      ok: false,
      message: 'The refit function is not deployed on this Supabase project yet.',
    });
    const thrown = client(async () => {
      throw new Error('offline');
    });
    expect(await refitClubs(thrown.c)).toEqual({ ok: false, message: 'refit failed: offline' });
    expect(thrown.invoke).toHaveBeenCalledWith('refit', { body: {} });
  });
});
