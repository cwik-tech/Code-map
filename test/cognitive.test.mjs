import assert from 'node:assert/strict';
import { test } from 'node:test';
import { analyzeFile, createResolver } from '../lib/analyze.mjs';
import { compareComplexity, functionList } from '../lib/complexity.mjs';

const resolve = createResolver(new Set(['a.ts']), { aliases: [], baseUrl: null });
const record = (source) => analyzeFile('a.ts', source, resolve).declarations[0].metrics.complexity;
const body = (text) => record(`export function f(x, y, list) { ${text} }`);

// Campbell (2017), Appendix B: structural, hybrid and fundamental increments.
const increments = [
  ['if', 'if (x) {}', 1], ['else if', 'if (x) {} else if (y) {}', 2],
  ['else', 'if (x) {} else {}', 2], ['conditional', 'return x ? y : list;', 1],
  ['switch', 'switch (x) { case 1: break; case 2: break; default: break; }', 1],
  ['for', 'for (;;) {}', 1], ['for in', 'for (const k in list) {}', 1],
  ['for of', 'for (const v of list) {}', 1], ['while', 'while (x) {}', 1],
  ['do while', 'do {} while (x);', 1], ['catch', 'try {} catch {}', 1],
  ['labelled break', 'outer: while (x) { break outer; }', 2],
  ['labelled continue', 'outer: while (x) { continue outer; }', 2],
  ['and sequence', 'return x && y && list;', 1], ['or sequence', 'return x || y || list;', 1],
  ['nullish sequence', 'return x ?? y ?? list;', 1], ['mixed sequence', 'return x && y || list;', 2],
  ['mixed nullish sequence', 'return (x ?? y) || list;', 2],
  ['recursion', 'return f(x);', 1],
  ['ignored syntax', 'try { x?.y; x &&= y; x ||= y; x ??= y; } finally { return; }', 0],
];
for (const [name, source, expected] of increments) test(`cognitive complexity counts ${name}`, () => {
  assert.equal(body(source).cognitive, expected);
});

const nested = [
  ['if', 'if (x) { if (y) {} }', 3], ['conditional', 'if (x) { return y ? 1 : 2; }', 3],
  ['switch', 'if (x) { switch (y) { case 1: break; } }', 3],
  ['for', 'if (x) { for (;;) {} }', 3], ['for in', 'if (x) { for (const k in list) {} }', 3],
  ['for of', 'if (x) { for (const v of list) {} }', 3], ['while', 'if (x) { while (y) {} }', 3],
  ['do while', 'if (x) { do {} while (y); }', 3], ['catch', 'if (x) { try {} catch {} }', 3],
  ['else if without nesting cost', 'while (x) { if (x) {} else if (y) {} else {} }', 5],
  ['else branch body', 'if (x) {} else { if (y) {} }', 4],
  ['else if branch body', 'if (x) {} else if (y) { if (list) {} }', 4],
  ['conditional branch body', 'return x ? (y ? 1 : 2) : 3;', 3],
  ['catch body', 'try {} catch { if (x) {} }', 3],
  ['ignored try and finally nesting', 'try { if (x) {} } finally { if (y) {} }', 2],
  ['logical operators without nesting cost', 'if (x) { return x && y || list; }', 3],
];
for (const [name, source, expected] of nested) test(`cognitive nesting counts ${name}`, () => {
  assert.equal(body(source).cognitive, expected);
});

test('logical sequences cross parentheses and restart for negated groups and call arguments', () => {
  assert.equal(body('return x && (y && list);').cognitive, 1);
  assert.equal(body('return x && !(y && list);').cognitive, 2);
  assert.equal(body('return x && g(y && list);').cognitive, 2);
  assert.equal(body('return x && y || list && x;').cognitive, 3);
});

test('nested functions keep separate values and inherit control and function nesting', () => {
  const outer = body('if (x) { const inner = () => { if (y) {} }; } function g() { while (x) {} }');
  assert.deepEqual([outer.cognitive, outer.cyclomatic, outer.nesting], [1, 2, 1]);
  assert.deepEqual(outer.functions.map(({ name, cognitive, cyclomatic, nesting }) => [name, cognitive, cyclomatic, nesting]),
    [['inner', 3, 2, 1], ['g', 2, 2, 1]]);
});

// Campbell (2017): sumOfPrimes uses two loops, an if and a labelled continue.
test('the paper sumOfPrimes example has cognitive complexity seven', () => {
  assert.equal(body(`let total = 0; OUT: for (let i = 1; i <= x; i++) {
    for (let j = 2; j < i; j++) { if (i % j === 0) { continue OUT; } } total += i;
  } return total;`).cognitive, 7);
});

test('recursive arrow bindings and methods count their direct calls', () => {
  assert.equal(record('export const f = (x) => x ? f(x - 1) : 0;').cognitive, 2);
  assert.equal(record('export const api = { f(x) { return this.f(x); } };').functions[0].cognitive, 1);
  assert.equal(body('return other.f(x);').cognitive, 0);
});

test('cognitive-only changes reach the flat list and comparison without changing other metrics', () => {
  const analysis = (text) => ({ files: [{ path: 'a.ts', declarations: [{ name: 'f', complexity: body(text) }] }] });
  const base = analysis('return x && y && list;'), head = analysis('return x && y || list;');
  assert.deepEqual(functionList(head.files), [{ path: 'a.ts', name: 'f', start: 1, end: 1, cyclomatic: 3, nesting: 0, cognitive: 2 }]);
  const delta = compareComplexity(base, head);
  assert.deepEqual(delta.counts, { grew: 1, new: 0, fell: 0, unknown: 0 });
  assert.deepEqual(delta.grew[0].delta, { lines: 0, cyclomatic: 0, nesting: 0, cognitive: 1 });
  assert.deepEqual(compareComplexity(head, base).fell[0].delta, { lines: 0, cyclomatic: 0, nesting: 0, cognitive: -1 });
});

// Campbell (2017): getWords uses a switch instead of a chain of nested decisions.
test('the paper getWords switch example has cognitive complexity one', () => {
  assert.equal(body(`switch (x) { case 1: return 'one'; case 2: return 'a couple';
    case 3: return 'a few'; default: return 'lots'; }`).cognitive, 1);
});

test('the paper mixed logical sequence example counts three sequences and one if', () => {
  assert.equal(body('if (a && b && c || d || e && f) {}').cognitive, 4);
});

test('the paper negated logical group example starts another sequence', () => {
  assert.equal(body('if (a && !(b && c)) {}').cognitive, 3);
});

const wrappers = [
  ['as', '(f as Callback)', '((y && list) as boolean)'],
  ['type assertion', '(<Callback>f)', '(<boolean>(y && list))'],
  ['satisfies', '(f satisfies Callback)', '((y && list) satisfies boolean)'],
  ['non-null assertion', 'f!', '(y && list)!'],
];
for (const [name, callee, expression] of wrappers) test(`type-only ${name} preserves recursion and logical sequences`, () => {
  assert.equal(body(`return ${callee}(x);`).cognitive, 1);
  assert.equal(body(`return x && ${expression};`).cognitive, 1);
});

test('an asserted arrow binding keeps its direct recursion increment', () => {
  assert.equal(record('export const f = ((x) => f(x)) as Callback;').functions[0].cognitive, 1);
});
