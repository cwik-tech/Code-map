import assert from 'node:assert/strict';
import { test } from 'node:test';
import { analyzeFile, createResolver } from '../lib/analyze.mjs';
import { apiSurface } from '../lib/api-surface.mjs';
import { compareApi } from '../lib/api-compare.mjs';
import { typedFacts } from '../lib/types/collect.mjs';
import { callSites } from '../lib/impact/calls.mjs';

function snapshot(code, extra = {}) {
  const texts = new Map(Object.entries({ 'tsconfig.json': '{"compilerOptions":{"strict":true,"allowJs":true},"include":["src/**/*.ts"]}', 'src/api.ts': code, ...extra }));
  const resolve = createResolver(new Set(texts.keys()), { aliases: [], baseUrl: null });
  const files = [...texts].filter(([path]) => /\.[jt]s$/.test(path)).map(([path, text]) => analyzeFile(path, text, resolve));
  return { texts, data: { analysis: { files: files.map((file) => ({ path: file.path, imports: file.edges })), api: apiSurface(files, []), typed: typedFacts(texts, { budgetMs: 15000 }) } } };
}
const compare = (a, b) => compareApi(a, b, { state: 'COMPARABLE' });

test('real checker snapshots keep equal inferred returns unchanged and detect argument return and overload changes', () => {
  const base = snapshot('export function value(x: number) { return x + 1; }');
  const equal = snapshot('export function value(x: number) { return x + 2; }');
  const argument = snapshot('export function value(x: string) { return x + 1; }');
  const returned = snapshot('export function value(x: number) { return String(x); }');
  const overloaded = snapshot('export function value(x: number): number; export function value(x: string): string; export function value(x: number | string) { return x; }');
  assert.equal(base.data.analysis.typed.state, 'COMPLETE');
  assert.equal(equal.data.analysis.typed.state, 'COMPLETE');
  assert.equal(base.data.analysis.typed.exports['src/api.ts'].value.shapeDigest, equal.data.analysis.typed.exports['src/api.ts'].value.shapeDigest);
  assert.deepEqual(compare(base, equal).items, []);
  assert.equal(compare(base, argument).items[0].status, 'CHANGED');
  assert.equal(compare(base, returned).items[0].status, 'CHANGED');
  assert.equal(compare(base, overloaded).items[0].status, 'CHANGED');
  assert.notEqual(base.data.analysis.typed.exports['src/api.ts'].value.shapeDigest, overloaded.data.analysis.typed.exports['src/api.ts'].value.shapeDigest);
  assert.notEqual(base.data.analysis.api.files['src/api.ts'][0].digest, overloaded.data.analysis.api.files['src/api.ts'][0].digest);
});

test('call reports retain unchecked JavaScript and spread consumers as UNKNOWN alongside compatible typed calls', () => {
  const head = snapshot('export function value(x: number): number { return x; }', {
    'src/checked.ts': "import { value } from './api'; value(1); const args: [number] = [1]; value(...args);",
    'src/unchecked.js': "import { value } from './api'; value('unchecked');",
  });
  const items = [{ group: 'module', status: 'CHANGED', path: 'src/api.ts', name: 'value', consumers: { items: [{ path: 'src/checked.ts', via: 'name' }, { path: 'src/unchecked.js', via: 'name' }] } }];
  const result = callSites(items, head, head.texts);
  assert.deepEqual(result.sites.map(({ path, compatibility }) => [path, compatibility]), [['src/checked.ts', 'COMPATIBLE'], ['src/checked.ts', 'UNKNOWN'], ['src/unchecked.js', 'UNKNOWN']]);
  assert.equal(result.sites[1].spread, true);
  assert.equal(result.sites[1].likelyBreak, null);
});

test('computed namespace consumers are separately reported as dynamic UNKNOWN uses', () => {
  const head = snapshot('export function value(x: number): number { return x; }', {
    'src/dynamic.ts': "import * as api from './api'; const key: string = 'value'; api[key](1); api[key](2); api['value'](3); function local(api: Record<string, Function>) { api[key](4); }",
  });
  const items = [{ group: 'module', status: 'CHANGED', path: 'src/api.ts', name: 'value', consumers: { items: [{ path: 'src/dynamic.ts', via: 'namespace' }] } }];
  const result = callSites(items, head, head.texts);
  assert.deepEqual(result.sites.map(({ path, compatibility }) => [path, compatibility]), [['src/dynamic.ts', 'UNKNOWN'], ['src/dynamic.ts', 'UNKNOWN'], ['src/dynamic.ts', 'UNKNOWN']]);
  assert.deepEqual(result.sites.slice(0, 2).map(({ dynamic, reason, likelyBreak, args }) => ({ dynamic, reason, likelyBreak, args })), [
    { dynamic: true, reason: 'computed-namespace-member', likelyBreak: null, args: 1 },
    { dynamic: true, reason: 'computed-namespace-member', likelyBreak: null, args: 1 },
  ]);
  assert.notEqual(result.sites[0].column, result.sites[1].column);
  assert.equal(result.sites[2].dynamic, undefined);
  assert.equal(result.sites[2].use, 'call');
});
