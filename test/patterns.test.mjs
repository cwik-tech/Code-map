// Operational pattern rules (C35): fetch without a signal, intervals that nothing clears, empty catch blocks and React effects without a cleanup.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { scanDeclaredPatterns } from '../lib/patterns.mjs';
import { analyzeFile, createResolver } from '../lib/analyze.mjs';
import { analyzeProject } from '../lib/analysis.mjs';
import { deriveFindings, findingRules } from '../lib/findings.mjs';

function findings(sources, tests = {}, policies = []) {
  const resolve = createResolver(new Set([...Object.keys(sources), ...Object.keys(tests)]), { aliases: [], baseUrl: null });
  const facts = (entries, options) => Object.entries(entries).map(([path, source]) => analyzeFile(path, source, resolve, options));
  const d = { project: 'fixture', ref: 'working tree', sha: 'fixture', coverageSnapshot: 'working-tree', rules: [],
    files: facts(sources), testFiles: facts(tests, { tests: true }).map((test) => ({ ...test, scan: test.testScan })), coChanges: { changes: {} }, changes: { uncommitted: [] } };
  d.analysis = analyzeProject(d);
  d.analysis.safeguards = { items: scanDeclaredPatterns(new Map(Object.entries(sources)), policies) };
  return deriveFindings(d.analysis);
}
const of = (list, ruleId) => list.filter((item) => item.ruleId === ruleId).map((item) => [item.location.path, item.location.line, item.location.symbol, item.facts.call]);

test('a global fetch with no signal in its object-literal options is a finding; other options and other fetch functions are not', () => {
  const list = findings({ 'src/api.ts': [
    'export async function load(url: string, init: RequestInit) {',
    '  await fetch(url);',
    "  await fetch(url, { method: 'POST' });",
    '  await window.fetch(`${url}/x`, { headers: {} });',
    '  await fetch(url, { signal: AbortSignal.timeout(5000) });',
    '  const signal = new AbortController().signal;',
    '  await fetch(url, { signal });',
    '  await fetch(url, init);',
    '  await fetch(url, { ...init });',
    '  await fetch(new Request(url, init));',
    '  await client.fetch(url);',
    '}',
    'const client = { fetch: (url: string) => url };',
    'export function wrapped(fetch: (url: string) => void) { fetch("/x"); }',
  ].join('\n') });
  assert.deepEqual(of(list, 'FETCH-NO-SIGNAL'), [
    ['src/api.ts', 2, 'load', 'fetch(url)'], ['src/api.ts', 3, 'load', 'fetch(url)'], ['src/api.ts', 4, 'load', 'window.fetch(`${url}/x`)'],
  ]);
  const two = list.filter((item) => item.ruleId === 'FETCH-NO-SIGNAL').slice(0, 2);
  assert.notEqual(two[0].id, two[1].id, 'two calls with the same text in one function get their position as part of the key');
  assert.match(two[0].text, /no signal/);
});

test('an interval with no handle, or with a handle in a file that never calls clearInterval, is a finding', () => {
  const list = findings({
    'src/poll.ts': 'export function start(tick: () => void) {\n  setInterval(tick, 1000);\n}\nexport function stop(id: number) { clearInterval(id); }\n',
    'src/poller.ts': 'export class Poller {\n  timer: unknown;\n  start() { this.timer = setInterval(() => this.poll(), 500); }\n  poll() {}\n}\n',
    'src/cleared.ts': 'export function run(tick: () => void) {\n  const id = setInterval(tick, 10);\n  return () => clearInterval(id);\n}\n',
    'src/returned.ts': 'export function every(tick: () => void) { return setInterval(tick, 10); }\n',
    'src/module.ts': 'setInterval(() => undefined, 60000);\nexport const ready = true;\n',
    'src/imported.ts': "import { setInterval } from 'node:timers/promises';\nexport async function wait() { for await (const _ of setInterval(10)) break; }\n",
  });
  assert.deepEqual(of(list, 'INTERVAL-NOT-CLEARED'), [['src/poll.ts', 2, 'start', 'setInterval(tick)'], ['src/poller.ts', 3, 'Poller.start', 'setInterval(<function>)']]);
  assert.deepEqual(list.filter((item) => item.ruleId === 'INTERVAL-NOT-CLEARED').map((item) => item.facts.reason), ['not-stored', 'never-cleared']);
  assert.ok(list.filter((item) => item.ruleId === 'INTERVAL-NOT-CLEARED').every((item) => item.severity === 'medium'));
});

test('a class field and a logical assignment keep an interval handle; a static field runs one time; a computed key can be the signal', () => {
  const list = findings({
    'src/ticker.ts': 'export class Ticker {\n  timer = setInterval(() => undefined, 100);\n  static shared = setInterval(() => undefined, 100);\n}\n',
    'src/lazy.ts': 'export class Lazy {\n  timer?: unknown;\n  start(tick: () => void) { this.timer ??= setInterval(tick, 100); }\n}\n',
    'src/keyed.ts': "const key = 'signal';\nexport const load = (url: string, s: AbortSignal) => fetch(url, { [key]: s });\n",
  });
  assert.deepEqual(list.filter((item) => item.ruleId === 'INTERVAL-NOT-CLEARED').map((item) => [item.location.path, item.location.line, item.location.symbol, item.facts.reason]),
    [['src/lazy.ts', 3, 'Lazy.start', 'never-cleared'], ['src/ticker.ts', 2, 'Ticker', 'never-cleared']]);
  assert.deepEqual(of(list, 'FETCH-NO-SIGNAL'), []);
});

test('an empty catch block with no comment is a finding; a comment or a statement makes it intentional', () => {
  const list = findings({ 'src/read.ts': [
    'export function read(text: string) {',
    '  try { return JSON.parse(text); } catch {}',
    '  try {',
    '    remove(text);',
    '  } catch (error) {',
    '  }',
    '  try { remove(text); } catch { /* the file can be gone */ }',
    '  try { remove(text); } catch {',
    '    // ignore: best effort',
    '  }',
    '  try { remove(text); } catch (error) { report(error); }',
    '}',
    'declare function remove(path: string): void;',
    'declare function report(error: unknown): void;',
  ].join('\n') });
  assert.deepEqual(of(list, 'CATCH-EMPTY'), [['src/read.ts', 2, 'read', 'return JSON.parse(text);'], ['src/read.ts', 5, 'read', 'remove(text);']]);
});

test('a React effect that subscribes and returns no cleanup function is a finding', () => {
  const list = findings({ 'src/Panel.tsx': [
    "import React, { useEffect, useLayoutEffect as layout } from 'react';",
    'export function Panel({ socket, store, el }: any) {',
    "  useEffect(() => { window.addEventListener('resize', onResize); }, []);",
    '  layout(() => { const id = setTimeout(onResize, 100); }, []);',
    "  React.useEffect(() => { socket.on('message', onResize); });",
    '  useEffect(() => { const sub = store.subscribe(onResize); }, [store]);',
    "  useEffect(() => document.addEventListener('keydown', onResize), []);",
    "  useEffect(() => { if (!el) return; el.addEventListener('click', onResize); }, [el]);",
    '  useEffect(() => { setInterval(onResize, 1000); }, []);',
    '  return null;',
    '}',
    'function onResize() {}',
  ].join('\n') });
  assert.deepEqual(of(list, 'EFFECT-NO-CLEANUP'), [
    ['src/Panel.tsx', 3, 'Panel', "window.addEventListener('resize')"], ['src/Panel.tsx', 4, 'Panel', 'setTimeout(onResize)'],
    ['src/Panel.tsx', 5, 'Panel', "socket.on('message')"], ['src/Panel.tsx', 6, 'Panel', 'store.subscribe(onResize)'],
    ['src/Panel.tsx', 7, 'Panel', "document.addEventListener('keydown')"], ['src/Panel.tsx', 8, 'Panel', "el.addEventListener('click')"],
    ['src/Panel.tsx', 9, 'Panel', 'setInterval(onResize)'],
  ]);
  const first = list.find((item) => item.ruleId === 'EFFECT-NO-CLEANUP');
  assert.equal(first.facts.hook, 'useEffect');
  assert.deepEqual(first.evidence.map((item) => item.line), [3]);
  assert.deepEqual(list.filter((item) => item.ruleId === 'EFFECT-NO-CLEANUP').map((item) => item.facts.hook), ['useEffect', 'useLayoutEffect', 'useEffect', 'useEffect', 'useEffect', 'useEffect', 'useEffect']);
});

test('an effect that returns a cleanup, subscribes only in a nested function or once, or is not React is not a finding', () => {
  const list = findings({
    'src/Clean.tsx': [
      "import { useEffect } from 'react';",
      'export const Clean = ({ store, socket }: any) => {',
      "  useEffect(() => { window.addEventListener('resize', f); return () => window.removeEventListener('resize', f); }, []);",
      '  useEffect(() => store.subscribe(f), [store]);',
      '  useEffect(() => { const sub = store.subscribe(f); return () => sub.unsubscribe(); }, [store]);',
      '  useEffect(() => { setTimeout(f, 100); }, []);',
      "  useEffect(() => { const later = () => socket.on('message', f); later(); }, []);",
      "  useEffect(() => { window.addEventListener('load', f, { once: true }); }, []);",
      '  useEffect(() => { const id = setInterval(f, 10); return () => clearInterval(id); }, []);',
      '  return null;',
      '};',
      'function f() {}',
    ].join('\n'),
    'src/Other.tsx': "function useEffect(run: () => void) { run(); }\nexport function Other() { useEffect(() => { window.addEventListener('resize', () => {}); }); return null; }\n",
  });
  assert.deepEqual(of(list, 'EFFECT-NO-CLEANUP'), []);
  assert.deepEqual(of(list, 'INTERVAL-NOT-CLEARED'), []);
});

test('the name path follows wrapped components, callbacks and default exports; async effects and timer calls that return the timer count', () => {
  const list = findings({
    'src/Page.tsx': [
      "import { memo, useCallback } from 'react';",
      "import * as R from 'react';",
      'export const Page = memo(() => {',
      "  R.useLayoutEffect(() => { window.addEventListener('scroll', f); });",
      "  R.useEffect(async () => { window.addEventListener('x', f); return () => window.removeEventListener('x', f); }, []);",
      "  const onClick = useCallback(() => fetch('/a'), []);",
      '  return null;',
      '});',
      'function f() {}',
    ].join('\n'),
    'src/main.ts': "export default function () { void fetch('/b'); }\n",
    'src/cache.js': "const fetch = require('node-fetch');\nfunction get(u) { return fetch(u); }\nfunction startCache(sweep) { setInterval(sweep, 60000).unref(); }\nmodule.exports = { get, startCache };\n",
  });
  assert.deepEqual(of(list, 'EFFECT-NO-CLEANUP'), [['src/Page.tsx', 4, 'Page', "window.addEventListener('scroll')"], ['src/Page.tsx', 5, 'Page', "window.addEventListener('x')"]]);
  assert.deepEqual(of(list, 'FETCH-NO-SIGNAL'), [['src/main.ts', 1, 'default', "fetch('/b')"], ['src/Page.tsx', 6, 'Page/onClick', "fetch('/a')"]]);
  assert.deepEqual(list.filter((item) => item.ruleId === 'INTERVAL-NOT-CLEARED').map((item) => [item.location.symbol, item.facts.reason]), [['startCache', 'not-stored']]);
});

test('test files get no pattern findings', () => {
  const body = "import { useEffect } from 'react';\nimport { test } from 'node:test';\ntest('x', async () => {\n  try { await fetch('/x'); } catch {}\n  setInterval(() => {}, 10);\n  useEffect(() => { window.addEventListener('resize', () => {}); });\n});\n";
  const list = findings({ 'src/ok.ts': 'export const ok = 1;\n' }, { 'test/patterns.test.ts': body, 'test/helpers/net.ts': body });
  const ops = list.filter((item) => findingRules[item.ruleId].capability === 'C35');
  assert.deepEqual(ops, []);
});

test('pattern finding IDs come from the path, the enclosing declaration and the call, so they survive line moves', () => {
  const source = 'export async function load(url: string) {\n  await fetch(url);\n  try { await fetch(`${url}/b`, { signal: undefined }); } catch {}\n}\n';
  const before = findings({ 'src/a.ts': source }), after = findings({ 'src/a.ts': '// a header\n\n' + source.replace('{\n', '{\n  const unused = 1;\n') });
  const ids = (list) => list.filter((item) => ['FETCH-NO-SIGNAL', 'CATCH-EMPTY'].includes(item.ruleId)).map((item) => item.id);
  assert.equal(ids(before).length, 2);
  assert.deepEqual(ids(after), ids(before));
  assert.notDeepEqual(after.filter((item) => item.ruleId === 'FETCH-NO-SIGNAL').map((item) => item.location.line), before.filter((item) => item.ruleId === 'FETCH-NO-SIGNAL').map((item) => item.location.line));
  const renamed = findings({ 'src/a.ts': source.replace('load', 'fetchAll') });
  assert.notDeepEqual(ids(renamed), ids(before), 'another enclosing declaration is another finding');
});

test('a ref owns stored subscription handles while local and discarded subscriptions stay visible', () => {
  const list = findings({ 'src/Timers.tsx': [
    "import { useEffect } from 'react';",
    'export function Timers({ timersRef, store, socket }) {',
    'useEffect(() => { const timer = window.setTimeout(f, 10); timersRef.current.set(1, timer); }, []);',
    'useEffect(() => { const timer = setInterval(f, 10); timersRef.current.handles.push(timer); }, []);',
    'useEffect(() => { const sub = store.subscribe(f); timersRef.current.sub = sub; }, []);',
    "useEffect(() => { timersRef.current.sub = socket.on('x', f); }, []);",
    'useEffect(() => { const timer = setTimeout(f, 10); }, []);',
    'useEffect(() => { store.subscribe(f); }, []);',
    "useEffect(() => { const timer = setTimeout(f, 10); timersRef.current.set(1, timer); socket.on('x', f); }, []);",
    'useEffect(() => () => { timersRef.current.forEach(clearTimeout); }, []);',
    'return null; } function f() {}',
  ].join('\n') });
  assert.deepEqual(of(list, 'EFFECT-NO-CLEANUP').map((item) => item[1]), [7, 8, 9]);
});

test('ref ownership follows assigned handles but not shadowed values or map keys', () => {
  const list = findings({ 'src/Assigned.tsx': [
    "import { useEffect } from 'react';",
    'export function Assigned({ ref, store }) {',
    'useEffect(() => { let timer; timer = setTimeout(f, 10); ref.current.set(1, timer); }, []);',
    'useEffect(() => { const timer = setTimeout(f, 10); { const timer = 0; ref.current.set(1, timer); } }, []);',
    'useEffect(() => { const sub = store.subscribe(f); ref.current.set(sub, 1); }, []);',
    'return null; } function f() {}',
  ].join('\n') });
  assert.deepEqual(of(list, 'EFFECT-NO-CLEANUP').map((item) => item[1]), [4, 5]);
});

test('storing an earlier value or a reassigned binding does not hide the timer that leaks', () => {
  const list = findings({ 'src/Leaks.tsx': [
    "import { useEffect } from 'react';",
    'export function Leaks({ ref }) {',
    'useEffect(() => { let timer = setTimeout(f, 10); timer = 0; ref.current.set(1, timer); }, []);',
    'useEffect(() => { let timer; ref.current.set(1, timer); timer = setTimeout(f, 10); }, []);',
    'return null; } function f() {}',
  ].join('\n') });
  assert.deepEqual(of(list, 'EFFECT-NO-CLEANUP').map((item) => item[1]), [3, 4]);
});


test('declared safeguard finding identities survive line moves and distinguish repeated calls', () => {
  const source = 'export function load() { retry(task, {}); retry(task, {}); }';
  const policies = [{ path: 'src/a.ts', symbol: 'load', retry: { callee: 'retry', maxAttempts: 3 } }];
  const rows = findings({ 'src/a.ts': source }, {}, policies).filter(x => x.ruleId === 'RETRY-POLICY');
  const moved = findings({ 'src/a.ts': '// header\n' + source }, {}, policies).filter(x => x.ruleId === 'RETRY-POLICY');
  assert.equal(rows.length, 2);
  assert.notEqual(rows[0].id, rows[1].id);
  assert.deepEqual(moved.map(x => x.id), rows.map(x => x.id));
});
