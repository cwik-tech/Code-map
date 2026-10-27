// Callback names follow their bindings or their call within the enclosing function.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { analyzeFile, createResolver } from '../lib/analyze.mjs';
import { compareComplexity } from '../lib/complexity.mjs';

const resolve = createResolver(new Set(['a.ts']), { aliases: [], baseUrl: null });
const record = (text) => analyzeFile('a.ts', text, resolve).declarations[0].metrics.complexity;
const names = (text) => record(text).functions.map((item) => item.name);
const analysis = (text) => ({ files: [{ path: 'a.ts', declarations: [{ name: 'hook', complexity: record(text) }] }] });

test('call arguments take the variable name through await, assertions and parentheses', () => {
  assert.deepEqual(names(`export async function hook() {
    const send = useCallback(async () => {});
    const load = await (wrap((() => {}) as Handler)) as Handler;
    const save = ((wrap(() => {})) as Handler);
    const direct = () => {};
    const obj = { field: () => {} };
    class View { field = () => {}; }
    const named = wrap(function own() {});
  }`), ['send', 'load', 'save', 'direct', 'field', 'field', 'own']);
});

test('call names use the last property and count calls only in the same enclosing function', () => {
  const value = record(`export function hook() {
    useEffect();
    useEffect(() => { useEffect(() => {}); });
    other(() => {});
    React.useEffect(() => {});
    const items = useMemo(() => list.map((item) => item));
    function inner() { list.map(() => {}); }
    list.map(() => {}, () => {});
    return (() => 1);
  }`);
  assert.deepEqual(value.functions.map((item) => item.name),
    ['useEffect#2', 'other#1', 'useEffect#3', 'items', 'inner', 'map#1', 'map#1', '<anonymous 1>']);
  assert.deepEqual(value.functions[0].functions.map((item) => item.name), ['useEffect#1']);
  assert.deepEqual(value.functions[3].functions.map((item) => item.name), ['map#1']);
  assert.deepEqual(value.functions[4].functions.map((item) => item.name), ['map#1']);
});

test('duplicate callback bindings match by position only when their counts agree', () => {
  const base = analysis('export function hook() { const send = wrap(() => 1, () => 2); }');
  const equal = analysis('export function hook() { const send = wrap(() => true ? 1 : 2, () => 2); }');
  assert.deepEqual(compareComplexity(base, equal).grew.map((item) => item.name), ['hook/send']);
  const fewer = analysis('export function hook() { const send = wrap(() => 1); }');
  assert.deepEqual(compareComplexity(base, fewer).unknown.map((item) => item.name), ['hook/send']);
});

test('empty property and class field names keep their existing names', () => {
  assert.deepEqual(names(`export function hook() {
    const obj = { '': () => {} };
    class View { '' = () => {}; }
    return () => {};
  }`), ['', '', '<anonymous 1>']);
});
