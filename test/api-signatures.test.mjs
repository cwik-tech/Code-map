import assert from 'node:assert/strict';
import { test } from 'node:test';
import { analyzeFile, createResolver } from '../lib/analyze.mjs';
import { apiSurface, packageEntryPoints } from '../lib/api-surface.mjs';
import { compareApi } from '../lib/api-compare.mjs';
import { digestOf, signatureLimit } from '../lib/api-signatures.mjs';

const files = new Set(['src/a.ts', 'src/b.ts', 'src/c.js', 'src/index.ts', 'src/features/one.ts', 'bin/cli.mjs', 'dist/index.js']);
const resolve = createResolver(files, { aliases: [], baseUrl: null });
const signatures = (text, path = 'src/a.ts') => Object.fromEntries(analyzeFile(path, text, resolve).signatures.map((record) => [record.name, record]));

test('a function signature drops the body and default values, and keeps an optional mark for a default value', () => {
  const { f } = signatures("export async function f<T extends string>(a: number, { b = 1, c }: { b?: number; c: string } = { c: '' }, ...rest: T[]): Promise<void> {\n  // a comment\n  return;\n}");
  assert.equal(f.kind, 'function');
  assert.equal(f.text, 'async function f<T extends string>(a: number, { b, c }?: { b?: number; c: string; }, ...rest: T[]): Promise<void>');
  assert.equal(f.inferred, false);
  assert.equal(f.digest, digestOf(f.text));
  assert.equal(f.source, undefined, 'a declared signature needs no source digest');
});

test('a body edit keeps the digest; a parameter, return type or overload edit changes it', () => {
  const base = signatures('export function f(a: string): string { return a; }').f;
  assert.equal(signatures('export function f(a: string): string {\n  return a + "";\n}').f.digest, base.digest);
  assert.notEqual(signatures('export function f(a: string, b: number): string { return a; }').f.digest, base.digest);
  assert.notEqual(signatures('export function f(a: string): number { return 1; }').f.digest, base.digest);
  const overloads = signatures('export function f(a: string): string;\nexport function f(a: number): number;\nexport function f(a: any) { return a; }').f;
  assert.equal(overloads.overloads, 2);
  assert.equal(overloads.text, 'function f(a: string): string\nfunction f(a: number): number', 'the implementation signature of overloads is not public');
});

test('a missing return or variable type is inferred, with a digest of its source', () => {
  const { g, value, typed, arrow } = signatures('export function g(a: number) { return a; }\nexport const value = 5;\nexport const typed: number = 5;\nexport const arrow = (a: number): string => String(a);');
  assert.deepEqual([g.text, g.inferred, typeof g.source], ['function g(a: number)', true, 'string']);
  assert.deepEqual([value.kind, value.text, value.inferred], ['const', 'const value', true]);
  assert.notEqual(signatures('export const value = 6;').value.source, value.source, 'a new initializer changes the source digest');
  assert.equal(signatures('export const value = /* five */ 5;').value.source, value.source, 'a comment does not count');
  assert.deepEqual([typed.text, typed.inferred], ['const typed: number', false]);
  assert.deepEqual([arrow.kind, arrow.text, arrow.inferred], ['const', 'const arrow = (a: number): string', false]);
});

test('a class signature lists its public members without bodies or initializers', () => {
  const { Box } = signatures([
    'export class Box<T> extends Array<T> implements Iterable<T> {',
    '  private hidden = 1; #secret = 2; count = 0; label: string;',
    '  constructor(public size: number, name = "x") { super(); }',
    '  get total() { return 1; }',
    '  put(item: T): void; put(item: T[]): void; put(item: any) {}',
    '  static make(): Box<number> { return new Box(1); }',
    '}'].join('\n'));
  assert.equal(Box.kind, 'class');
  assert.equal(Box.text, 'class Box<T> extends Array<T> implements Iterable<T> { count; label: string; constructor(public size: number, name?); get total(); put(item: T): void; put(item: T[]): void; static make(): Box<number> }');
  assert.equal(Box.inferred, true, 'count and total have inferred types');
});

test('types, interfaces and enums print in full; a kind change and a re-export are recorded', () => {
  const found = signatures("import { b } from './b';\nexport interface Shape { /* c */ x:   number; y?(): void }\nexport type Id<T> = T | 'none';\nexport enum Color { Red = 1, Blue }\nexport { b as bee };\nexport * from './c';\nexport { other } from 'package';");
  assert.equal(found.Shape.text, 'interface Shape { x: number; y?(): void; }');
  assert.equal(found.Id.text, "type Id<T> = T | 'none'");
  assert.equal(found.Color.text, 'enum Color { Red = 1, Blue }');
  assert.deepEqual([found.bee.kind, found.bee.from, found.bee.text], ['reexport', { target: 'src/b.ts', specifier: './b', name: 'b' }, "export { b as bee } from './b'"]);
  assert.deepEqual(found['*'].from, { target: 'src/c.js', specifier: './c', name: '*' });
  assert.deepEqual(found.other.from, { target: null, specifier: 'package', name: 'other' });
  assert.equal(signatures('export function f() {}').f.kind, 'function');
  assert.equal(signatures('export const f = () => {};').f.kind, 'const');
});

test('local exports, default exports and CommonJS exports get the signature of what they name', () => {
  const found = signatures('function run(a: number): number { return a; }\nexport { run as go };\nexport default run;');
  assert.deepEqual([found.go.text, found.default.text], ['function run(a: number): number', 'function run(a: number): number']);
  const common = signatures('function helper(a) { return a; }\nmodule.exports = helper;\nexports.extra = (b) => b;', 'src/c.js');
  assert.deepEqual([common['module.exports'].text, common.extra.kind], ['function helper(a)', 'function']);
});

test('a long signature is cut at the limit, and the digest covers the full text', () => {
  const members = Array.from({ length: 40 }, (_, index) => `field${index}: string;`).join(' ');
  const { Wide } = signatures(`export interface Wide { ${members} }`);
  assert.equal(Wide.text.length, signatureLimit);
  assert.equal(Wide.truncated, true);
  assert.notEqual(Wide.digest, digestOf(Wide.text));
});

test('entry points come from the package.json fields, and test imports of source files are kept', () => {
  const texts = new Map([['package.json', JSON.stringify({ main: 'dist/index.js', bin: { tool: './bin/cli.mjs' },
    exports: { '.': { import: './src/index.ts', types: './src/index.d.ts' }, './features/*': './src/features/*.js' } })], ['broken/package.json', '{']]);
  const sources = ['src/a.ts', 'src/index.ts', 'src/features/one.ts', 'bin/cli.mjs'];
  const entries = packageEntryPoints(texts, sources, resolve);
  assert.deepEqual(entries.files, [{ path: 'bin/cli.mjs', package: 'package.json', fields: ['bin'] },
    { path: 'src/features/one.ts', package: 'package.json', fields: ['exports'] }, { path: 'src/index.ts', package: 'package.json', fields: ['exports'] }]);
  assert.deepEqual(entries.unresolved, [{ package: 'package.json', field: 'exports', target: './src/index.d.ts', reason: 'not-found' },
    { package: 'package.json', field: 'main', target: 'dist/index.js', reason: 'not-mapped' }]);
  const test = analyzeFile('test/a.test.ts', "import { f } from '../src/a';\nimport { gone } from '../src/gone';\nimport assert from 'node:assert';", resolve, { tests: true });
  const api = apiSurface([analyzeFile('src/a.ts', 'export const f = 1;', resolve)], [test], entries);
  assert.deepEqual(api.testImports, [{ source: 'test/a.test.ts', target: 'src/a.ts', specifier: '../src/a', line: 1, names: ['f'], kind: 'value', mode: 'static' },
    { source: 'test/a.test.ts', target: null, specifier: '../src/gone', line: 2, names: ['gone'], kind: 'value', mode: 'static' }]);
  assert.deepEqual(Object.keys(api.files), ['src/a.ts']);
  assert.equal(test.signatures, undefined, 'test files get no signatures');
});

/** A stored analysis of these source files, with the imports that resolve in this snapshot only. */
const snapshot = (sources, entries = []) => {
  const own = createResolver(new Set(Object.keys(sources)), { aliases: [], baseUrl: null });
  const facts = Object.entries(sources).map(([path, text]) => analyzeFile(path, text, own));
  return { data: { analysis: { files: facts.map((file) => ({ path: file.path, imports: file.edges })),
    api: apiSurface(facts, [], { files: entries.map((path) => ({ path, package: 'package.json', fields: ['main'] })), unresolved: [] }) } } };
};

test('the comparison marks a kind change, an entry point that is gone and a removal that can be a move', () => {
  const base = snapshot({ 'src/a.ts': 'export function f(): void {}', 'src/b.ts': 'export const gone = 1;' }, ['src/a.ts']);
  const head = snapshot({ 'src/a.ts': 'export const f = (): void => {};' });
  const result = compareApi(base, head, { complete: false, state: 'COMPARABLE' });
  assert.deepEqual(result.items.map((item) => [item.group, item.path, item.name, item.status, item.reasons]), [
    ['public', 'src/a.ts', 'f', 'REMOVED', ['entry-removed']],
    ['module', 'src/a.ts', 'f', 'CHANGED', ['kind']],
    ['module', 'src/b.ts', 'gone', 'UNKNOWN', ['file-removed', 'renames-incomplete']]]);
  assert.deepEqual([result.entryPoints.removed, result.entryPoints.added], [['src/a.ts'], []]);
  assert.deepEqual(compareApi(base, head, { state: 'NOT_COMPARABLE', reasons: ['analyzer'] }).items, []);
});

test('a removed export of a moved file lists the consumers that still import the old path', () => {
  const base = snapshot({ 'src/lib/a.ts': 'export function keep(): void {}\nexport function drop(): void {}', 'src/use.ts': "import { drop } from './lib/a';\n",
    'src/ok.ts': "import { keep } from './lib/a';\n" });
  const head = snapshot({ 'src/lib/b.ts': 'export function keep(): void {}', 'src/use.ts': "import { drop } from './lib/a';\n", 'src/ok.ts': "import { keep } from './lib/b';\n" });
  const result = compareApi(base, head, { renames: [{ from: 'src/lib/a.ts', to: 'src/lib/b.ts', similarity: 80 }], state: 'COMPARABLE' });
  assert.deepEqual(result.items.map((item) => [item.status, item.path, item.basePath, item.name, item.consumers]), [
    ['REMOVED', 'src/lib/b.ts', 'src/lib/a.ts', 'drop', { total: 1, items: [{ path: 'src/use.ts', line: 1, via: 'unresolved' }] }]]);
});

test('a file that imports the name through a re-export is a consumer, with the file that it imports', () => {
  const files = (leaf) => ({ 'src/lib/a.ts': leaf, 'src/lib/index.ts': "export * from './a';\n", 'src/app.ts': "import { drop } from './lib/index';\n",
    'src/top.ts': "export { drop as gone } from './lib/index';\n", 'src/z.ts': "import { gone } from './top';\nimport * as lib from './lib';\n" });
  const result = compareApi(snapshot(files('export function keep(): void {}\nexport function drop(): void {}')), snapshot(files('export function keep(): void {}')), { state: 'COMPARABLE' });
  assert.deepEqual(result.items.map((item) => [item.status, item.path, item.name]), [['REMOVED', 'src/lib/a.ts', 'drop']]);
  assert.deepEqual(result.items[0].consumers.items, [{ path: 'src/app.ts', line: 1, via: 'name', through: 'src/lib/index.ts' },
    { path: 'src/lib/index.ts', line: 1, via: 'namespace' }, { path: 'src/top.ts', line: 1, via: 'name', through: 'src/lib/index.ts' },
    { path: 'src/z.ts', line: 1, via: 'name', through: 'src/top.ts' }], 'a named import through two re-exports is stronger than the namespace import');
});

test('string literals keep their white space, destructured names have a signature, and a deep package.json is cut', () => {
  assert.notEqual(signatures("export type T = 'a  b';").T.digest, signatures("export type T = 'a b';").T.digest);
  assert.equal(signatures("export type T =\n  | 'a'\n  | 'b';").T.text, "type T = 'a' | 'b'");
  const { a } = signatures('const { a, b } = make();\nexport { a };');
  assert.deepEqual([a.kind, a.text, a.inferred], ['const', 'const { a, b }', true], 'a destructured name is declared, not unknown');
  assert.equal(signatures('export class Empty { private constructor() {} }').Empty.text, 'class Empty {}');
  const deep = `{"exports":${'['.repeat(5000)}"./src/a.ts"${']'.repeat(5000)}}`;
  assert.deepEqual(packageEntryPoints(new Map([['package.json', deep]]), ['src/a.ts'], resolve), { files: [], unresolved: [] });
});

test('checker equality preserves changed explicit syntax signatures', async () => {
  const { typedChange } = await import('../lib/types/api.mjs');
  const a = signatures('export function f(input: string): void {}').f;
  const b = signatures('export function f(renamed: string): void {}').f;
  const typed = { state: 'COMPLETE', exports: { 'src/a.ts': { f: { state: 'KNOWN', text: 'same', shapeDigest: 'same' } } } };
  const stored = { data: { analysis: { typed } } };
  assert.equal(typedChange(stored, stored, 'src/a.ts', 'src/a.ts', a, b), undefined);
});

for (const [label, code, extra] of [
  ['local parameter', 'interface Shape { value: TYPE } export function f(x: Shape): void {}', {}],
  ['imported return', "import type { Shape } from './model'; export declare function f(): Shape;", { 'src/model.ts': 'export interface Shape { value: TYPE }' }],
]) test(`explicit ${label} changes are visible behind stable syntax signatures`, async () => {
  const { typedFacts } = await import('../lib/types/collect.mjs');
  const build = (type) => {
    const source = code.replace('TYPE', type);
    const texts = new Map([['tsconfig.json', '{"compilerOptions":{"strict":true}}'], ['src/a.ts', source],
      ...Object.entries(extra).map(([path, text]) => [path, text.replace('TYPE', type)])]);
    const snapshot = { data: { analysis: { files: [{ path: 'src/a.ts', imports: [] }], typed: typedFacts(texts),
      api: { files: { 'src/a.ts': Object.values(signatures(source)) }, entryPoints: { files: [] } } } } };
    return snapshot;
  };
  const a = build('string'), b = build('number');
  assert.equal(a.data.analysis.api.files['src/a.ts'][0].digest, b.data.analysis.api.files['src/a.ts'][0].digest);
  assert.equal(compareApi(a, b, { state: 'COMPARABLE' }).items.find((item) => item.name === 'f')?.status, 'CHANGED');
});
