import { readFile } from 'node:fs/promises';
import path from 'node:path';

/**
 * Serves MapLibre GL's web-worker bundle. maplibre-gl v6 is ESM-only and
 * locates its worker next to its own module URL, which the bundler rewrites, so
 * the client calls `setWorkerUrl('/courses/maplibre/maplibre-gl-worker.mjs')`.
 * The worker imports `./maplibre-gl-shared.mjs`, which resolves here too.
 * (next.config.ts traces both files into the server output.)
 */
const FILES = new Set(['maplibre-gl-worker.mjs', 'maplibre-gl-shared.mjs']);

async function readDist(file: string): Promise<Buffer> {
  // node_modules may be hoisted to the workspace root: walk up from the app.
  let dir = process.cwd();
  for (let i = 0; i < 4; i++) {
    try {
      return await readFile(path.join(dir, 'node_modules', 'maplibre-gl', 'dist', file));
    } catch {
      dir = path.dirname(dir);
    }
  }
  throw new Error(`maplibre-gl/dist/${file} not found`);
}

export async function GET(_req: Request, ctx: { params: Promise<{ file: string }> }) {
  const { file } = await ctx.params;
  if (!FILES.has(file)) return new Response('Not found', { status: 404 });
  const body = await readDist(file);
  return new Response(new Uint8Array(body), {
    headers: {
      'content-type': 'text/javascript; charset=utf-8',
      'cache-control': 'public, max-age=86400',
    },
  });
}
