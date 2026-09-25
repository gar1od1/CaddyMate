/**
 * `_shared/engine` must be exactly what `pnpm vendor:engine` produces from
 * packages/engine/src (see scripts/vendor_lib.mts).
 */
import { assertEquals } from '@std/assert';
import { fromFileUrl, join } from '@std/path';
import * as vendored from './engine/index.ts';
import * as workspace from '@caddymate/engine';
import {
  expectedVendor,
  listVendored,
  transformSource,
  VENDOR_DIR,
  VENDOR_HEADER,
} from '../scripts/vendor_lib.mts';

const REPO_ROOT = join(fromFileUrl(new URL('.', import.meta.url)), '..', '..', '..');
const HINT = 'the vendored engine is out of date — run `pnpm vendor:engine` from the repo root';

Deno.test('vendored engine matches packages/engine/src byte-for-byte (after .js → .ts)', () => {
  const expected = expectedVendor(REPO_ROOT);
  assertEquals(listVendored(REPO_ROOT), [...expected.keys()], `file list differs: ${HINT}`);
  for (const [rel, content] of expected) {
    const actual = Deno.readTextFileSync(join(REPO_ROOT, ...VENDOR_DIR, rel));
    assertEquals(actual === content, true, `${rel} differs: ${HINT}`);
  }
});

Deno.test('vendored engine exports the same API', () => {
  assertEquals(Object.keys(vendored).sort(), Object.keys(workspace).sort());
  assertEquals(vendored.CONDITION_MODEL_VERSION, workspace.CONDITION_MODEL_VERSION);
  assertEquals(vendored.DISPERSION_ENGINE_VERSION, workspace.DISPERSION_ENGINE_VERSION);
});

Deno.test('vendor transform rewrites relative .js specifiers only', () => {
  const src = [
    "import { a } from './a.js';",
    "export * from '../b/index.js';",
    'import type { C } from "./c.js";',
    "const d = await import('./d.js');",
    "import x from 'pkg/x.js';",
    "const s = 'not ./an/import.js';",
  ].join('\n');
  assertEquals(
    transformSource(src),
    VENDOR_HEADER +
      [
        "import { a } from './a.ts';",
        "export * from '../b/index.ts';",
        'import type { C } from "./c.ts";',
        "const d = await import('./d.ts');",
        "import x from 'pkg/x.js';",
        "const s = 'not ./an/import.js';",
      ].join('\n'),
  );
});
