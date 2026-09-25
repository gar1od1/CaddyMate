// Babel config: the Expo preset plus one small rewrite.
//
// The workspace packages (@caddymate/engine, @caddymate/api) are TypeScript
// sources that import siblings with ESM-style `.js` specifiers
// (`./geo/index.js` → geo/index.ts), which tsc, vitest, Next and Deno all
// understand but Metro does not. This plugin strips the `.js` from relative
// specifiers when a matching `.ts`/`.tsx` file exists next to the importer.
const fs = require('fs');
const path = require('path');

function rewriteTsJsSpecifiers() {
  const fix = (source, file) => {
    if (!source || !file) return;
    const spec = source.value;
    if (!spec.startsWith('.') || !spec.endsWith('.js')) return;
    const base = path.resolve(path.dirname(file), spec.slice(0, -3));
    if (fs.existsSync(`${base}.ts`) || fs.existsSync(`${base}.tsx`)) {
      source.value = spec.slice(0, -3);
    }
  };
  return {
    name: 'caddymate-ts-js-specifiers',
    visitor: {
      ImportDeclaration(p, state) {
        fix(p.node.source, state.filename);
      },
      ExportAllDeclaration(p, state) {
        fix(p.node.source, state.filename);
      },
      ExportNamedDeclaration(p, state) {
        fix(p.node.source, state.filename);
      },
    },
  };
}

module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: [rewriteTsJsSpecifiers],
  };
};
