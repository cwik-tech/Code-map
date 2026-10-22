import assert from 'node:assert/strict';
import { test } from 'node:test';
import { analyzeFile, createResolver } from '../lib/analyze.mjs';

const resolve = createResolver(new Set(['src/a.ts', 'src/b.ts', 'src/c.ts']), { aliases: [], baseUrl: null });
test('dependency evidence distinguishes types, values, side effects and dynamic imports at their source lines', () => {
  const f = analyzeFile('src/a.ts', "import type { B } from './b';\nimport { type C, run } from './b';\nimport './c';\nconst lazy = () => import('./c');\nconst old = require('./b');\nexport type { B } from './b';\nimport('unresolved');", resolve);
  assert.deepEqual(f.edges.map(e => [e.target, e.kind, e.mode, e.line]), [
    ['src/b.ts', 'type', 'static', 1], ['src/b.ts', 'value', 'static', 2], ['src/c.ts', 'side-effect', 'static', 3],
    ['src/b.ts', 'type', 'static', 6], ['src/c.ts', 'value', 'dynamic', 4], ['src/b.ts', 'value', 'require', 5],
    [null, 'value', 'dynamic', 7],
  ]);
  assert.deepEqual(f.edges[1].typeNames, ['C']);
  assert.deepEqual(f.edges[1].valueNames, ['run']);
});

test('declaration metrics count bound import references and React hook call sites without shadowed names', () => {
  const source = "import { useState as state, useEffect } from 'react';\nimport { run } from './b';\nexport function Panel() {\n  const [value] = state(0);\n  useEffect(() => { run(); }, []);\n  function nested(run: () => void) { run(); }\n  return value;\n}\nexport function unrelated(run: () => void) { run(); }\n";
  const f = analyzeFile('src/a.ts', source, resolve);
  const panel = f.declarations.find(d => d.name === 'Panel');
  assert.equal(panel.metrics.lines, 6);
  assert.deepEqual(panel.metrics.internalDependencies, ['src/b.ts']);
  assert.deepEqual(panel.metrics.hookCalls.map(h => [h.name, h.line]), [['useState', 4], ['useEffect', 5]]);
  assert.deepEqual(f.declarations.find(d => d.name === 'unrelated').metrics.internalDependencies, []);
});

test('export evidence distinguishes types, aliases, reexports and local references', () => {
  const f = analyzeFile('src/a.ts', "export interface Shape {}\nexport function local() { return 1; }\nexport const value = local();\nexport { local as renamed };\nexport type { Shape as Remote } from './b';\nexport default local;", resolve);
  assert.deepEqual(f.exportDetails.map(e => [e.name, e.category, e.localName]), [
    ['Shape', 'type', 'Shape'], ['local', 'value', 'local'], ['value', 'value', 'value'],
    ['renamed', 'reexport', 'local'], ['Remote', 'reexport', null], ['default', 'reexport', 'local'],
  ]);
  assert.equal(f.exportDetails.find(e => e.name === 'local').localReferences, 1);
});

test('type queries stay type-only and dynamic imports retain evidence with options or unknown targets', () => {
  const f = analyzeFile('src/a.ts', "type B = import('./b').B;\nconst load = () => import('./c', { with: { type: 'json' } });\nconst variable = (name: string) => import(name);", resolve);
  assert.deepEqual(f.edges.map(e => [e.target, e.kind, e.mode, e.line]), [
    ['src/b.ts', 'type', 'type-query', 1], ['src/c.ts', 'value', 'dynamic', 2], [null, 'value', 'dynamic', 3],
  ]);
});

test('custom hook aliases and React namespace calls are counted as hook candidates but shadowed calls are not', () => {
  const f = analyzeFile('src/a.ts', "import * as React from 'react';\nimport { useThing as thing } from './b';\nexport function Panel() { thing(); React.useEffect(() => {}, []); }\nexport function other(thing: () => void) { thing(); }", resolve);
  assert.deepEqual(f.declarations.find(d => d.name === 'Panel').metrics.hookCalls.map(h => h.name), ['useThing', 'useEffect']);
  assert.deepEqual(f.declarations.find(d => d.name === 'other').metrics.hookCalls, []);
});

test('each declaration owns its metrics even when variables and methods share a source line', () => {
  const f = analyzeFile('src/a.ts', "import { run } from './b';\nexport const first = () => run(), second = () => 1;\nexport class Example { first() { run(); } second() { return 1; } }", resolve);
  assert.deepEqual(f.declarations.find(d => d.name === 'second').metrics.internalDependencies, []);
  assert.deepEqual(f.declarations.find(d => d.name === 'Example').children.find(d => d.name === 'second').metrics.internalDependencies, []);
});

test('overloads have one export record and shorthand object properties count as local references', () => {
  const f = analyzeFile('src/a.ts', "export function local(x: string): string;\nexport function local(x: number): number;\nexport function local(x: string | number) { return x; }\nexport const object = {local};", resolve);
  const exports = f.exportDetails.filter(e => e.name === 'local');
  assert.equal(exports.length, 1);
  assert.equal(exports[0].line, 3);
  assert.equal(exports[0].localReferences, 1);
});
