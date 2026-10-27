import assert from 'node:assert/strict';
import { test } from 'node:test';
import { analyzeFile, createResolver } from '../lib/analyze.mjs';
import { functionList } from '../lib/complexity.mjs';

const resolve = createResolver(new Set(['a.ts']), { aliases: [], baseUrl: null });
const declarations = (source) => analyzeFile('a.ts', source, resolve).declarations;
const complexityOf = (source, name) => declarations(source).find((d) => d.name === name).metrics.complexity;
/** The values of a function `f` whose body is `body`. */
const body = (text) => complexityOf(`export function f(x, y, list) {\n${text}\n}\n`, 'f');

test('cyclomatic complexity counts every decision point and not the default clause', () => {
  const source = `export function all(x, y, list) {
  if (x) return 1;
  const a = y ? 1 : 2;
  switch (x) { case 1: return 1; default: return 0; }
  for (let i = 0; i < 3; i++) {}
  for (const k in list) {}
  for (const v of list) {}
  while (x) {}
  do {} while (x);
  try {} catch (e) {}
  const b = x && y;
  const c = x || y;
  const d = x ?? y;
  x &&= y;
  x ||= y;
  x ??= y;
  return 0;
}\n`;
  assert.equal(complexityOf(source, 'all').cyclomatic, 16);
});

test('each counted construct adds exactly one, and other syntax adds nothing', () => {
  const one = {
    if: 'if (x) {}', ternary: 'return x ? 1 : 2;', case: 'switch (x) { case 1: break; }', for: 'for (;;) {}', 'for in': 'for (const k in list) {}',
    'for of': 'for (const v of list) {}', while: 'while (x) {}', do: 'do {} while (x);',
    catch: 'try {} catch {}', '&&': 'return x && y;', '||': 'return x || y;', '??': 'return x ?? y;', '&&=': 'x &&= y;', '||=': 'x ||= y;', '??=': 'x ??= y;',
  };
  for (const [construct, text] of Object.entries(one)) assert.equal(body(text).cyclomatic, 2, construct);
  assert.equal(complexityOf('export async function f(list) { for await (const v of list) {} }\n', 'f').cyclomatic, 2, 'for await');
  const none = { default: 'switch (x) { default: break; }', 'optional chaining': 'return x?.a?.b?.();', finally: 'try {} finally {}',
    else: 'if (x) {} else {}', 'plain assignment': 'x = y;', 'other operators': 'return (x === y) + (x | y) + (x & y);', 'type condition': 'type T<A> = A extends string ? 1 : 2;' };
  for (const [construct, text] of Object.entries(none)) assert.equal(body(text).cyclomatic, construct === 'else' ? 2 : 1, construct);
  assert.equal(body('switch (x) { case 1: case 2: return 1; case 3: return 2; default: return 0; }').cyclomatic, 4, 'each case of a fall-through group counts');
  assert.equal(body('if (x ? y : !y) {}').cyclomatic, 3, 'a ternary inside a condition counts too');
  assert.equal(body('if (x) {} else if (y) {} else {}').cyclomatic, 3, 'else if counts, else does not');
});

test('nesting depth counts if, loops, switch, try and catch, with try and catch as one level', () => {
  const source = `export function deep(x) {
  if (x) { while (x) { switch (x) { case 1: try { for (;;) {} } catch (e) {} } } }
}\n`;
  assert.equal(complexityOf(source, 'deep').nesting, 5);
  assert.equal(body('try {} catch { if (x) {} } finally { while (x) {} }').nesting, 2, 'a catch or finally block is at the level of its try');
  assert.equal(body('x; y && list;').nesting, 0);
  assert.equal(body('if (x) if (y) return 1;').nesting, 2, 'an if without braces still nests');
});

test('an else if chain stays at the level of its first if', () => {
  assert.equal(body('if (x === 1) {} else if (x === 2) {} else if (x === 3) {} else {}').nesting, 1);
  assert.equal(body('if (x) {} else if (y) { if (list) {} } else { while (x) {} }').nesting, 2);
  assert.equal(body('if (x) {} else { if (y) {} }').nesting, 2, 'an if inside an else block nests');
});

test('a nested function has its own values and does not add to the outer function', () => {
  const source = `export function outer(x) {
  const first = () => { if (x) {} };
  [1].map(() => {});
  function named() { return x ? 1 : 2; }
  return [2].map((v) => v && x);
}\n`;
  const complexity = complexityOf(source, 'outer');
  assert.deepEqual([complexity.cyclomatic, complexity.nesting], [1, 0]);
  assert.deepEqual(complexity.functions.map((f) => [f.name, f.cyclomatic, f.nesting]), [
    ['first', 2, 1], ['map#1', 1, 0], ['named', 2, 0], ['map#2', 2, 0],
  ], 'variable bindings and call positions name the functions');
  assert.equal(complexity.functions[1].functions, undefined, 'an empty list of nested functions is left out');
});

test('a class method, an accessor and an arrow variable record their own complexity', () => {
  const source = `export class Parser {
  parse(x) { if (x) return x; }
  static empty() { return 1; }
  get size() { return this.n ? 1 : 0; }
  set size(v) { if (v) { if (v > 1) this.n = v; } }
}
export const run = (x) => x ? 1 : 2;\n`;
  const list = declarations(source), parser = list.find((d) => d.name === 'Parser');
  assert.equal(parser.metrics.complexity, undefined, 'the class itself is not a function, and it has no other function inside');
  assert.equal(parser.children.find((d) => d.name === 'parse').metrics.complexity.cyclomatic, 2);
  assert.equal(parser.children.find((d) => d.name === 'empty').metrics.complexity.cyclomatic, 1);
  assert.deepEqual(parser.children.filter((d) => d.name === 'size').map((d) => [d.metrics.complexity.cyclomatic, d.metrics.complexity.nesting]), [[2, 0], [3, 2]]);
  assert.equal(list.find((d) => d.name === 'run').metrics.complexity.cyclomatic, 2);
});

test('functions inside a class field, an object or a wrapper call are recorded under that declaration', () => {
  const source = `export class View {
  handler = (e) => { if (e) {} };
  render() { return 1; }
}
export const api = { get(x) { return x || 1; }, put: (y) => y ?? 2 };
export const handler = wrap(async (req) => { if (req) { for (;;) {} } });\n`;
  const list = declarations(source), names = (name) => list.find((d) => d.name === name).metrics.complexity.functions.map((f) => [f.name, f.cyclomatic, f.nesting]);
  assert.deepEqual(names('View'), [['handler', 2, 1]], 'the method render has its own record and is not repeated under the class');
  assert.deepEqual(names('api'), [['get', 2, 0], ['put', 2, 0]]);
  assert.deepEqual(names('handler'), [['handler', 3, 2]]);
  assert.equal(list.find((d) => d.name === 'api').metrics.complexity.cyclomatic, undefined, 'an object has no own values');
  assert.equal(declarations('export const limit = 5;\n')[0].metrics.complexity, undefined, 'a value without functions has no record');
});

test('the flat list uses a name path and records nested functions under their parent', () => {
  const files = [{ path: 'a.ts', declarations: [
    { name: 'Parser.parse', complexity: { cyclomatic: 1, nesting: 0, functions: [{ name: 'helper', cyclomatic: 1, nesting: 0 }] } },
    { name: 'api', complexity: { functions: [{ name: '<anonymous 1>', cyclomatic: 2, nesting: 1 }] } },
  ] }];
  assert.deepEqual(functionList(files), [
    { path: 'a.ts', name: 'Parser.parse', start: null, end: null, cyclomatic: 1, nesting: 0 },
    { path: 'a.ts', name: 'Parser.parse/helper', start: null, end: null, cyclomatic: 1, nesting: 0 },
    { path: 'a.ts', name: 'api/<anonymous 1>', start: null, end: null, cyclomatic: 2, nesting: 1 },
  ], 'a record of an earlier version has no lines');
});

test('each function record has the start and end lines of the function itself, and the flat list gives them', () => {
  const source = `export const run =\n  (x) => {\n    return [x].map((v) =>\n      v + 1);\n  };\nexport function outer() {\n  function inner() {}\n}\nexport const api = { get(x) { return x; } };\n`;
  const list = declarations(source), find = (name) => list.find((d) => d.name === name).metrics.complexity;
  assert.deepEqual([list.find((d) => d.name === 'run').start, find('run').start, find('run').end], [1, 2, 5], 'the arrow function starts on line 2, after its declaration');
  assert.deepEqual(find('run').functions.map((f) => [f.name, f.start, f.end]), [['map#1', 3, 4]], 'a callback takes the name of its callee and its ordinal');
  assert.deepEqual([find('outer').start, find('outer').end, find('outer').functions[0].start], [6, 8, 7]);
  const files = [{ path: 'a.ts', declarations: list.map((d) => ({ name: d.name, complexity: d.metrics.complexity })) }];
  assert.deepEqual(functionList(files).map((f) => [f.name, f.start, f.end]), [['run', 2, 5], ['run/map#1', 3, 4], ['outer', 6, 8], ['outer/inner', 7, 7], ['api/get', 9, 9]]);
});
