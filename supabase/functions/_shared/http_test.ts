import { assert, assertEquals, assertRejects, assertThrows } from '@std/assert';
import { bearerToken } from './auth.ts';
import {
  ensureOk,
  errorJson,
  fetchWithTimeout,
  HttpError,
  json,
  mapLimit,
  parseCoord,
  serveJson,
} from './http.ts';

Deno.test('bearerToken extracts the JWT', () => {
  const req = (h?: string) =>
    new Request('https://x', h ? { headers: { Authorization: h } } : undefined);
  assertEquals(bearerToken(req('Bearer abc.def.ghi')), 'abc.def.ghi');
  assertEquals(bearerToken(req('bearer   t')), 't');
  assertEquals(bearerToken(req('Basic xyz')), null);
  assertEquals(bearerToken(req()), null);
});

Deno.test('json / errorJson shape responses with CORS', async () => {
  const ok = json({ a: 1 }, 201);
  assertEquals(ok.status, 201);
  assertEquals(ok.headers.get('Access-Control-Allow-Origin'), '*');
  assertEquals(await ok.json(), { a: 1 });
  const e = errorJson(new HttpError(418, 'teapot', 'short and stout'));
  assertEquals(e.status, 418);
  assertEquals(await e.json(), { error: { code: 'teapot', message: 'short and stout' } });
  const origError = console.error;
  console.error = () => {};
  try {
    const opaque = errorJson(new Error('secret detail'));
    assertEquals(opaque.status, 500);
    assertEquals(await opaque.json(), { error: { code: 'internal', message: 'Internal error' } });
  } finally {
    console.error = origError;
  }
});

Deno.test('serveJson answers preflight and maps thrown errors', async () => {
  const h = serveJson(() => Promise.reject(new HttpError(400, 'bad_request', 'nope')));
  const pre = await h(new Request('https://x', { method: 'OPTIONS' }));
  assertEquals(pre.status, 204);
  const res = await h(new Request('https://x'));
  assertEquals(res.status, 400);
  assertEquals((await res.json()).error.code, 'bad_request');
});

Deno.test('fetchWithTimeout maps timeouts and network errors', async () => {
  const hang = (_u: string, init?: RequestInit) =>
    new Promise<Response>((_, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted')));
    });
  const t = await assertRejects(() => fetchWithTimeout('https://x', {}, 10, hang), HttpError);
  assertEquals(t.status, 504);
  const down = () => Promise.reject(new TypeError('connection refused'));
  const n = await assertRejects(() => fetchWithTimeout('https://x', {}, 1000, down), HttpError);
  assertEquals(n.status, 502);
  const ok = await fetchWithTimeout('https://x', {}, 1000, () =>
    Promise.resolve(new Response('hi')),
  );
  assertEquals(await ok.text(), 'hi');
});

Deno.test('ensureOk names the host but never the query string', async () => {
  const url = 'https://api.mapbox.com/v4/t.pngraw?access_token=SECRET';
  const e = await assertRejects(
    () => ensureOk(new Response('nope', { status: 401 }), url),
    HttpError,
  );
  assertEquals(e.status, 502);
  assert(e.message.includes('api.mapbox.com returned 401'));
  assert(!e.message.includes('SECRET'));
});

Deno.test('mapLimit keeps order and bounds concurrency', async () => {
  let inFlight = 0;
  let peak = 0;
  const out = await mapLimit([5, 1, 4, 2, 3], 2, async (v, i) => {
    inFlight++;
    peak = Math.max(peak, inFlight);
    await new Promise((r) => setTimeout(r, v));
    inFlight--;
    return v * 10 + i;
  });
  assertEquals(out, [50, 11, 42, 23, 34]);
  assertEquals(peak, 2);
  assertEquals(await mapLimit([], 3, () => Promise.resolve(1)), []);
});

Deno.test('parseCoord validates numbers and ranges', () => {
  assertEquals(parseCoord('53.42', 'lat', -90, 90), 53.42);
  assertEquals(parseCoord(-6.9, 'lng', -180, 180), -6.9);
  for (const bad of [null, '', 'abc', '91', Infinity, {}]) {
    assertThrows(() => parseCoord(bad, 'lat', -90, 90), HttpError);
  }
});
