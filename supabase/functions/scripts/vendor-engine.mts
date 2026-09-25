/**
 * `pnpm vendor:engine` — copy packages/engine/src into
 * supabase/functions/_shared/engine (see vendor_lib.mts). Replaces the
 * directory wholesale so deleted engine files disappear from the copy.
 * Node ≥ 22.18 runs this directly (type stripping); Deno works too:
 * `deno run -A supabase/functions/scripts/vendor-engine.mts`.
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { VENDOR_DIR, expectedVendor } from './vendor_lib.mts';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const out = join(repoRoot, ...VENDOR_DIR);
const files = expectedVendor(repoRoot);
rmSync(out, { recursive: true, force: true });
for (const [rel, content] of files) {
  const p = join(out, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, content);
}
console.log(`vendored ${files.size} engine files into ${VENDOR_DIR.join('/')}`);
