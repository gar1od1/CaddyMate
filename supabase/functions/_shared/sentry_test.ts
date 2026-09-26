import { assert, assertEquals } from '@std/assert';
import { HttpError, isReportable, serveJson } from './http.ts';
import { buildEvent, envelope, functionName, parseDsn, reportError } from './sentry.ts';

const DSN = 'https://abc123@o42.ingest.sentry.io/7';

Deno.test('parseDsn builds the envelope URL, with or without a path prefix', () => {
  assertEquals(parseDsn(DSN), {
    envelopeUrl: 'https://o42.ingest.sentry.io/api/7/envelope/',
    publicKey: 'abc123',
    dsn: DSN,
  });
  assertEquals(
    parseDsn('http://k@sentry.local:9000/prefix/3')?.envelopeUrl,
    'http://sentry.local:9000/prefix/api/3/envelope/',
  );
  assertEquals(parseDsn(undefined), null);
  assertEquals(parseDsn(''), null);
  assertEquals(parseDsn('not a url'), null);
  assertEquals(parseDsn('https://o42.ingest.sentry.io/7'), null); // no key
  assertEquals(parseDsn('https://k@o42.ingest.sentry.io/'), null); // no project
});

Deno.test('functionName reads the deployed and local paths', () => {
  assertEquals(
    functionName(new Request('https://x.supabase.co/functions/v1/weather?lat=1')),
    'weather',
  );
  assertEquals(functionName(new Request('http://localhost/refit')), 'refit');
  assertEquals(functionName(new Request('http://localhost/')), 'unknown');
});

Deno.test('buildEvent / envelope carry tags but no query string', () => {
  const req = new Request('https://x.supabase.co/functions/v1/weather?lat=53.1&lng=-6.2');
  const ev = buildEvent(new TypeError('boom'), req, 'test', new Date(1_000_000));
  assertEquals(ev.timestamp, 1000);
  assertEquals(ev.environment, 'test');
  assertEquals((ev.tags as Record<string, string>).function, 'weather');
  assertEquals((ev.tags as Record<string, string>).engine_version, '1');
  assertEquals(ev.request, { method: 'GET', url: 'https://x.supabase.co/functions/v1/weather' });
  assertEquals(ev.exception, { values: [{ type: 'TypeError', value: 'boom' }] });
  assert(typeof (ev.extra as { stack: string }).stack === 'string');
  assertEquals((ev.event_id as string).length, 32);
  const nonError = buildEvent('plain', req, 'test');
  assertEquals(nonError.exception, { values: [{ type: 'NonError', value: 'plain' }] });
  assertEquals(nonError.extra, undefined);

  const lines = envelope(parseDsn(DSN)!, ev, new Date(0)).split('\n');
  assertEquals(lines.length, 4); // three JSON lines + trailing newline
  assertEquals(JSON.parse(lines[0]!), {
    event_id: ev.event_id,
    dsn: DSN,
    sent_at: '1970-01-01T00:00:00.000Z',
  });
  assertEquals(JSON.parse(lines[1]!), { type: 'event' });
  assertEquals(JSON.parse(lines[2]!).event_id, ev.event_id);
});

Deno.test('reportError posts one envelope when a DSN is set, and never rejects', async () => {
  const req = new Request('https://x/functions/v1/refit', { method: 'POST' });
  const calls: { url: string; init?: RequestInit }[] = [];
  const ok = (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return Promise.resolve(new Response('{}', { status: 200 }));
  };
  assertEquals(await reportError(new Error('x'), req, { dsn: '', fetch: ok }), false);
  assertEquals(calls.length, 0);
  assertEquals(
    await reportError(new Error('x'), req, { dsn: DSN, environment: 'e', fetch: ok }),
    true,
  );
  assertEquals(calls.length, 1);
  assertEquals(calls[0]!.url, 'https://o42.ingest.sentry.io/api/7/envelope/');
  const headers = calls[0]!.init!.headers as Record<string, string>;
  assert(headers['X-Sentry-Auth']!.includes('sentry_key=abc123'));

  const origError = console.error;
  console.error = () => {};
  try {
    const down = () => Promise.reject(new TypeError('offline'));
    assertEquals(await reportError(new Error('x'), req, { dsn: DSN, fetch: down }), false);
    const hang = (_u: string, init?: RequestInit) =>
      new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted')));
      });
    assertEquals(
      await reportError(new Error('x'), req, { dsn: DSN, fetch: hang, timeoutMs: 5 }),
      false,
    );
    const rejected = () => Promise.resolve(new Response('no', { status: 429 }));
    assertEquals(await reportError(new Error('x'), req, { dsn: DSN, fetch: rejected }), false);
  } finally {
    console.error = origError;
  }
});

Deno.test('reportError is off without SENTRY_DSN in the environment', async () => {
  const prev = Deno.env.get('SENTRY_DSN');
  Deno.env.delete('SENTRY_DSN');
  try {
    assertEquals(await reportError(new Error('x'), new Request('https://x/weather')), false);
  } finally {
    if (prev !== undefined) Deno.env.set('SENTRY_DSN', prev);
  }
});

Deno.test('serveJson reports server errors only', async () => {
  assert(isReportable(new Error('x')));
  assert(isReportable(new HttpError(502, 'upstream_error', 'x')));
  assert(!isReportable(new HttpError(404, 'not_found', 'x')));

  const reported: unknown[] = [];
  const report = (err: unknown) => {
    reported.push(err);
    return Promise.resolve(true);
  };
  const origError = console.error;
  console.error = () => {};
  try {
    const boom = new Error('boom');
    const res = await serveJson(() => Promise.reject(boom), report)(new Request('https://x'));
    assertEquals(res.status, 500);
    assertEquals(reported, [boom]);
    const bad = serveJson(() => Promise.reject(new HttpError(400, 'bad_request', 'no')), report);
    assertEquals((await bad(new Request('https://x'))).status, 400);
    assertEquals(reported.length, 1);
    // A failing reporter never changes the response.
    const flaky = serveJson(
      () => Promise.reject(new Error('y')),
      () => Promise.reject(new Error('sentry down')),
    );
    assertEquals((await flaky(new Request('https://x'))).status, 500);
  } finally {
    console.error = origError;
  }
});
