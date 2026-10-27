import assert from 'node:assert/strict';
import { test } from 'node:test';
import { analyzeFile, createResolver } from '../lib/analyze.mjs';
import { changeImpact } from '../lib/impact/reach.mjs';

test('unresolved computed loaders and their importers remain conservative impact candidates', () => {
  const texts = { 'src/api.ts': 'export const value = 1;', 'src/loader.ts': 'export const load = (path: string) => import(path);', 'src/use.ts': "import { load } from './loader'; export const use = load;" };
  const resolve = createResolver(new Set(Object.keys(texts)), { aliases: [], baseUrl: null });
  const files = Object.entries(texts).map(([path, text]) => { const facts = analyzeFile(path, text, resolve); return { path, imports: facts.edges }; });
  const result = changeImpact({ files }, ['src/api.ts']);
  assert.equal(result.complete, false);
  assert.deepEqual(result.files, []);
  assert.deepEqual(result.tests, []);
  assert.deepEqual(result.candidates.map(({ path, reason, loader }) => [path, reason, loader]), [
    ['src/loader.ts', 'unresolved-computed-loader', 'src/loader.ts'],
    ['src/use.ts', 'unresolved-computed-loader', 'src/loader.ts'],
  ]);
  assert.deepEqual(result.dynamicImports, { files: 1, sites: 1 });
});


test('computed require templates name matching files separately without changing definite impact or tests', () => {
  const texts = {
    'src/loader.ts': 'export const load = (name: string) => require(`./plugins/${name}.ts`);',
    'src/plugins/a.ts': 'export const a = 1;',
    'src/plugins/b.ts': 'export const b = 2;',
    'src/plugins/nested/c.ts': 'export const c = 3;',
    'src/loader.test.ts': "import { load } from './loader'; load('a');",
  };
  const resolve = createResolver(new Set(Object.keys(texts)), { aliases: [], baseUrl: null });
  const files = Object.entries(texts).map(([path, text]) => ({ path, imports: analyzeFile(path, text, resolve).edges }));
  const result = changeImpact({ files }, ['src/plugins/a.ts']);
  assert.equal(result.complete, false);
  assert.deepEqual(result.files, []);
  assert.deepEqual(result.tests, []);
  assert.deepEqual(result.candidates.map(({ path }) => path), ['src/plugins/a.ts', 'src/plugins/b.ts', 'src/loader.ts', 'src/loader.test.ts']);
  assert.equal(result.candidates[0].reason, 'computed-loader-pattern');
  assert.equal(result.candidates[0].loader, 'src/loader.ts');
});
