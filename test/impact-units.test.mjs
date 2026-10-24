// The pure parts of the change impact (lib/impact/): the reverse walk with its limits, the stale-reference search, the
// call sites with their argument counts, and the documentation facts of the public API.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { analyzeFile, createResolver } from '../lib/analyze.mjs';
import { apiSurface } from '../lib/api-surface.mjs';
import { callSites } from '../lib/impact/calls.mjs';
import { documentationLeads, isDocumentation, publicDocumentation } from '../lib/impact/docs.mjs';
import { changeImpact, impactLimits, removedImports } from '../lib/impact/reach.mjs';
import { findReferences, placeOf, referenceTerms } from '../lib/impact/references.mjs';
import { impactSummary } from '../lib/impact/report.mjs';

/** A head analysis from import lists: `{ importer: [[target, kind], …] }`. A path under test/ is a test file. */
function graph(imports) {
  const paths = new Set([...Object.keys(imports), ...Object.values(imports).flat().map(([target]) => target).filter(Boolean)]);
  const edge = (source, [target, kind, specifier = target ? `./${target}` : null]) => ({ source, target, kind, mode: specifier === null ? 'dynamic' : 'static', specifier, line: 1, names: [] });
  const tests = [...paths].filter((path) => path.startsWith('test/'));
  return { files: [...paths].filter((path) => !tests.includes(path)).map((path) => ({ path, imports: (imports[path] ?? []).map((item) => edge(path, item)) })),
    tests: { testFiles: tests.map((path) => ({ path })) }, api: { testImports: tests.flatMap((path) => (imports[path] ?? []).map((item) => edge(path, item))) } };
}
const chain = (length) => Object.fromEntries(Array.from({ length }, (_, index) => [`src/c${index + 1}.ts`, [[`src/c${index}.ts`, 'value']]]));

test('the walk counts the importers by depth and stops at the depth limit with an explicit marker', () => {
  const short = changeImpact(graph(chain(3)), ['src/c0.ts'], { depth: 3, files: 100 });
  assert.deepEqual([short.total, short.truncated, short.complete], [3, null, true], 'a chain that ends at the limit is complete');
  const long = changeImpact(graph(chain(5)), ['src/c0.ts'], { depth: 3, files: 100 });
  assert.deepEqual(long.byDepth, [{ depth: 1, files: 1, tests: 0 }, { depth: 2, files: 1, tests: 0 }, { depth: 3, files: 1, tests: 0 }]);
  assert.deepEqual([long.total, long.truncated, long.complete], [3, { limit: 'depth', value: 3 }, false]);
  assert.deepEqual(long.files.map((item) => [item.path, item.depth, item.imports]), [['src/c1.ts', 1, 'src/c0.ts'], ['src/c2.ts', 2, 'src/c1.ts'], ['src/c3.ts', 3, 'src/c2.ts']]);
  assert.deepEqual(changeImpact(graph(chain(12)), ['src/c0.ts']).truncated, { limit: 'depth', value: impactLimits.depth }, 'the fixed default limit');
});

test('the walk stops at the file limit, and the marker names that limit', () => {
  const fan = Object.fromEntries(Array.from({ length: 6 }, (_, index) => [`src/user${index}.ts`, [['src/core.ts', 'value']]]));
  const result = changeImpact(graph(fan), ['src/core.ts'], { depth: 10, files: 4 });
  assert.deepEqual([result.total, result.truncated, result.complete], [4, { limit: 'files', value: 4 }, false]);
  assert.deepEqual(result.limits, { depth: 10, files: 4 });
});

test('a type-only edge is counted apart from value edges, and a file behind it is affected only through types', () => {
  const result = changeImpact(graph({ 'src/b.ts': [['src/a.ts', 'type']], 'src/c.ts': [['src/b.ts', 'value']], 'src/d.ts': [['src/a.ts', 'value'], ['src/a.ts', 'type']],
    'test/d.test.ts': [['src/d.ts', 'value']], 'test/a.test.ts': [['src/a.ts', 'side-effect']] }), ['src/a.ts', 'test/a.test.ts', 'README.md']);
  assert.deepEqual(result.changed, { sources: 1, tests: 1, other: 1 });
  assert.deepEqual(result.edges, { value: 4, type: 1, unknown: 0 }, 'one value import makes the pair of files a value edge');
  assert.deepEqual(result.kinds, { value: 2, type: 2 });
  assert.deepEqual(result.files.map((item) => [item.path, item.depth, item.kind, item.test]), [['src/b.ts', 1, 'type', false], ['src/d.ts', 1, 'value', false],
    ['src/c.ts', 2, 'type', false], ['test/d.test.ts', 2, 'value', true]]);
  assert.deepEqual(result.tests.map((item) => [item.path, item.depth, item.kind]), [['test/a.test.ts', 0, 'changed'], ['test/d.test.ts', 2, 'value']]);
});

test('a dynamic import with a computed target makes the walk incomplete, with the count', () => {
  const result = changeImpact(graph({ 'src/b.ts': [['src/a.ts', 'value']], 'src/loader.ts': [[null, 'value'], [null, 'value']], 'test/x.test.ts': [[null, 'value']] }), ['src/a.ts']);
  assert.deepEqual([result.truncated, result.complete, result.dynamicImports], [null, false, { files: 2, sites: 3 }]);
});

test('removed-file imports seed the head walk, also after a consumer rename', () => {
  const before = head({ 'src/old.ts': 'export const oldName = 1;', 'src/use.ts': "import { oldName } from './old';" }).data.analysis;
  const after = head({ 'src/renamed.ts': "import { oldName } from './old';", 'src/top.ts': "import './renamed';" },
    { 'test/use.test.ts': "import '../src/top';" }).data.analysis;
  const removed = removedImports(before, after, ['src/old.ts'], [{ from: 'src/use.ts', to: 'src/renamed.ts' }]);
  const result = changeImpact(after, [], impactLimits, removed);
  assert.deepEqual(result.files.map(({ path, depth }) => [path, depth]), [['src/renamed.ts', 1], ['src/top.ts', 2], ['test/use.test.ts', 3]]);
  assert.deepEqual(result.tests.map(({ path }) => path), ['test/use.test.ts']);
});

test('a moved export excludes its live declaration, re-exports and importers from stale-name leads', () => {
  const analysis = head({ 'src/new.ts': 'export function oldName() {}', 'src/index.ts': "export { oldName } from './new';",
    'src/use.ts': "import { oldName } from './index'; oldName();" }).data.analysis;
  const terms = referenceTerms([{ status: 'REMOVED', path: 'src/old.ts', name: 'oldName', consumers: { items: [] } }], [], [], analysis);
  const texts = new Map([['src/new.ts', 'export function oldName() {}'], ['src/index.ts', "export { oldName } from './new';"],
    ['src/use.ts', "import { oldName } from './index'; oldName();"], ['notes.md', 'Remove oldName from the old module.']]);
  assert.deepEqual(findReferences(texts, terms, []).hits.map(({ path }) => path), ['notes.md']);
});

test('places, terms and the text search: word boundaries, short names, excluded importers and mock paths', () => {
  assert.deepEqual(['src/a.ts', 'src/a.d.ts', 'test/a.test.ts', 'vitest.config.ts', '.eslintrc.cjs', 'docs/a.md', 'a.json', '.github/ci.yml', 'node_modules/x/a.js', 'dist/a.js', 'pnpm-lock.yaml', 'a.png']
    .map(placeOf), ['code', 'code', 'test', 'config', 'config', 'markdown', 'json', 'yaml', null, 'generated', null, null]);
  const items = [{ group: 'module', status: 'REMOVED', path: 'src/dates.ts', name: 'formatDate', consumers: { items: [{ path: 'src/user.ts' }] }, base: {} },
    { group: 'module', status: 'REMOVED', path: 'src/dates.ts', name: 'max', consumers: { items: [] }, base: {} },
    { group: 'module', status: 'CHANGED', path: 'src/dates.ts', name: 'parseDate', consumers: { items: [] }, base: {} }];
  const terms = referenceTerms(items, [{ path: 'src/old-helper.ts', status: 'D', from: null }, { path: 'src/new.ts', status: 'R', from: 'src/moved.ts' }, { path: 'src/dates.ts', status: 'M', from: null }], []);
  assert.deepEqual(terms.names.map((term) => term.name), ['formatDate']);
  assert.deepEqual(terms.skipped, [{ name: 'max', path: 'src/dates.ts', reason: 'short' }]);
  assert.deepEqual(terms.paths.map((term) => [term.path, term.to]), [['src/moved.ts', 'src/new.ts'], ['src/old-helper.ts', null]]);
  const texts = new Map([
    ['test/x.test.ts', "import { other } from '../src/dates';\nvi.mock('../src/old-helper', () => ({}));\nconst formatDates = 1;\n"],
    ['src/user.ts', "import { formatDate } from './dates';\nformatDate();\n"],
    ['src/broken.ts', "import { helper } from './old-helper';\nexport const x = helper;\n"],
    ['src/loader.ts', "export const load = () => import('./moved');\n"],
    ['docs/guide.md', 'Call `formatDate` from src/old-helper.ts or [the helper](../src/old-helper.ts).\n'],
    ['config/app.json', '{ "formatter": "formatDate" }\n']]);
  const edges = [{ source: 'src/broken.ts', target: null, specifier: './old-helper', mode: 'static', line: 1 }];
  const found = findReferences(texts, terms, edges);
  assert.deepEqual(found.hits.map((hit) => [hit.path, hit.line, hit.place, hit.term.kind, hit.match]), [
    ['config/app.json', 1, 'json', 'export', 'name'], ['docs/guide.md', 1, 'markdown', 'export', 'name'], ['docs/guide.md', 1, 'markdown', 'path', 'path'],
    ['src/loader.ts', 1, 'code', 'path', 'specifier'], ['test/x.test.ts', 2, 'test', 'path', 'specifier']]);
  assert.equal(found.hits.find((hit) => hit.path === 'test/x.test.ts').text, "vi.mock('../src/old-helper', () => ({}));");
  assert.deepEqual(found.hits[0].term, { kind: 'export', name: 'formatDate', files: ['src/dates.ts'] });
  assert.deepEqual(found.hits[3].term, { kind: 'path', path: 'src/moved.ts', to: 'src/new.ts' });
  assert.deepEqual(found.truncated, null);
});

test('a term stops at its hit limit, and the marker counts the terms that reached it', () => {
  const terms = referenceTerms([{ group: 'module', status: 'REMOVED', path: 'src/a.ts', name: 'common', consumers: { items: [] }, base: {} }], [], []);
  const found = findReferences(new Map([['notes.md', 'common\n'.repeat(150)]]), terms, [], 100);
  assert.deepEqual([found.hits.length, found.truncated], [100, { limit: 'hits-per-term', value: 100, terms: 1 }]);
});

/** Stored head facts of these files, as the collector makes them. */
function head(sources, tests = {}) {
  const resolve = createResolver(new Set([...Object.keys(sources), ...Object.keys(tests)]), { aliases: [], baseUrl: null });
  const files = Object.entries(sources).map(([path, text]) => analyzeFile(path, text, resolve));
  const testFacts = Object.entries(tests).map(([path, text]) => analyzeFile(path, text, resolve, { tests: true }));
  return { data: { analysis: { files: files.map((file) => ({ path: file.path, imports: file.edges, exports: file.exportDetails })), api: apiSurface(files, testFacts, { files: [], unresolved: [] }) } } };
}

test('the stored test imports let the walk reach a test through a test helper and through a side-effect import', () => {
  const stored = head({ 'src/a.ts': 'export const a = 1;\n' }, { 'test/helper.ts': "import { a } from '../src/a';\nexport const h = a;\n",
    'test/b.test.ts': "import { h } from './helper';\n", 'test/c.test.ts': "import '../src/a';\n" });
  assert.deepEqual(stored.data.analysis.api.testImports.map((edge) => [edge.source, edge.target, edge.kind]),
    [['test/helper.ts', 'src/a.ts', 'value'], ['test/b.test.ts', 'test/helper.ts', 'value'], ['test/c.test.ts', 'src/a.ts', 'side-effect']]);
  const result = changeImpact(stored.data.analysis, ['src/a.ts']);
  assert.deepEqual(result.tests.map((item) => [item.path, item.depth, item.kind, item.imports]),
    [['test/c.test.ts', 1, 'value', 'src/a.ts'], ['test/helper.ts', 1, 'value', 'src/a.ts'], ['test/b.test.ts', 2, 'value', 'test/helper.ts']]);
});

test('the signature records hold the argument range and the JSDoc fact of each declaration', () => {
  const facts = head({ 'src/a.ts': '/** Adds. */\nexport function add(a: number, b = 1, ...rest: number[]) { return a; }\nexport const f = function (this: void, a: string, b?: string) { return a; };\n'
    + 'export class Box { constructor(a: string) {} }\nexport class Empty {}\nexport class Child extends Box {}\n/**/\nexport const value = 1;\n',
  'src/b.js': 'export function loose(a, b) { return a; }\nexport function spread() { return arguments.length; }\n' }).data.analysis.api.files;
  const by = (path) => Object.fromEntries(facts[path].map((record) => [record.name, [record.arity ?? null, record.documented]]));
  assert.deepEqual(by('src/a.ts'), { add: [{ min: 1, max: null }, true], f: [{ min: 1, max: 2 }, false], Box: [{ min: 1, max: 1 }, false], Empty: [{ min: 0, max: 0 }, false],
    Child: [null, false], value: [null, false] }, 'an empty JSDoc comment does not document');
  assert.deepEqual(by('src/b.js'), { loose: [{ min: 0, max: 2 }, false], spread: [{ min: 0, max: null }, false] }, 'a JavaScript parameter is optional, and `arguments` takes any number');
});

test('the call sites of a changed export count the arguments, also through a namespace and a renamed re-export', () => {
  const sources = { 'src/a.ts': 'export function f(a: string, b?: number): string { return a; }\nexport function g(...xs: number[]) { return 1; }\n',
    'src/index.ts': "export { f as fmt } from './a';\n",
    'src/use.ts': "import { f, g } from './a';\nimport * as ns from './a';\nimport { fmt } from './index';\nf();\nf('x', 1);\nf('x', 1, 2);\nns.f('x');\nconst ref = f;\nfmt('a', 2, 3);\ng(1, 2, 3, 4, 5);\nf(...[]);\n" };
  const stored = head(sources, { 'test/a.test.ts': "import { f } from '../src/a';\nf('x');\n" });
  const consumers = [{ path: 'src/index.ts', line: 1, via: 'name' }, { path: 'src/use.ts', line: 1, via: 'name' }, { path: 'test/a.test.ts', line: 1, via: 'name' }];
  const items = [{ group: 'module', status: 'CHANGED', path: 'src/a.ts', name: 'f', head: { kind: 'function' }, consumers: { total: 3, items: consumers } },
    { group: 'module', status: 'CHANGED', path: 'src/a.ts', name: 'g', head: { kind: 'function' }, consumers: { total: 1, items: [{ path: 'src/use.ts', line: 1, via: 'name' }] } }];
  const result = callSites(items, stored, new Map([...Object.entries(sources), ['test/a.test.ts', "import { f } from '../src/a';\nf('x');\n"]]));
  const brief = (site) => [site.export.name, site.path, site.line, site.use, site.args, site.likelyBreak];
  assert.deepEqual(result.sites.map(brief), [['f', 'src/use.ts', 4, 'call', 0, true], ['f', 'src/use.ts', 6, 'call', 3, true], ['f', 'src/use.ts', 9, 'call', 3, true],
    ['f', 'src/use.ts', 5, 'call', 2, false], ['f', 'src/use.ts', 7, 'call', 1, false], ['f', 'src/use.ts', 8, 'reference', null, null], ['f', 'src/use.ts', 11, 'call', 1, null],
    ['f', 'test/a.test.ts', 2, 'call', 1, false], ['g', 'src/use.ts', 10, 'call', 5, false]]);
  assert.equal(result.sites.find((site) => site.line === 11).spread, true);
  assert.deepEqual(result.exports.map((entry) => [entry.name, entry.arity, entry.sites, entry.likelyBreaks]), [['f', { min: 1, max: 2 }, 8, 3], ['g', { min: 0, max: null }, 1, 0]]);
  assert.deepEqual(result.unread, []);
});

test('the public exports without JSDoc, and the documentation leads of a change', () => {
  const sources = { 'src/index.ts': "export { a, b } from './lib';\nexport * from 'pkg';\n/** Local. */\nexport const local = 1;\n", 'src/lib.ts': '/** A. */\nexport function a() {}\nexport function b() {}\n' };
  const stored = head(sources);
  stored.data.analysis.api.entryPoints = { files: [{ path: 'src/index.ts', package: 'package.json', fields: ['main'] }], unresolved: [] };
  const docs = publicDocumentation(stored.data.analysis);
  assert.deepEqual([docs.entryPoints, docs.exports, docs.documented, docs.undocumented, docs.unknown], [1, 4, 2, 1, 1]);
  assert.deepEqual(docs.items, [{ path: 'src/index.ts', name: 'b', kind: 'function', declaredIn: 'src/lib.ts', line: 3 }]);
  assert.equal(publicDocumentation({ ...stored.data.analysis, api: { ...stored.data.analysis.api, schemaVersion: 1 } }), null, 'an older analysis has no documentation facts');
  assert.deepEqual(['README.md', 'docs/api.txt', 'packages/x/docs/a.json', 'src/doc.ts'].map(isDocumentation), [true, true, true, false]);
  const items = [{ group: 'public', status: 'CHANGED', path: 'src/index.ts', name: 'a', reasons: ['signature'], head: { declaredIn: 'src/lib.ts' } },
    { group: 'public', status: 'ADDED', path: 'src/index.ts', name: 'c', reasons: [], head: { declaredIn: 'src/lib.ts' } },
    { group: 'module', status: 'REMOVED', path: 'src/lib.ts', name: 'z', reasons: [], head: null, base: {} }];
  const without = documentationLeads(items, [{ path: 'src/lib.ts', status: 'M' }]);
  assert.deepEqual([without.publicChanges, without.docsChanged, without.leads], [1, [], [{ path: 'src/index.ts', name: 'a', status: 'CHANGED', reasons: ['signature'], declaredIn: 'src/lib.ts' }]]);
  const withDocs = documentationLeads(items, [{ path: 'src/lib.ts', status: 'M' }, { path: 'docs/api.md', status: 'M' }]);
  assert.deepEqual([withDocs.publicChanges, withDocs.docsChanged, withDocs.leads], [1, ['docs/api.md'], []]);
});

test('a changed public re-export checks callers against its new declaration', () => {
  const sources = { 'src/index.ts': "export { format } from './new';", 'src/new.ts': 'export function format(a: string, b: string): string { return a + b; }',
    'src/use.ts': "import { format } from './index';\nformat('one');" };
  const stored = head(sources);
  const items = [{ group: 'public', status: 'CHANGED', path: 'src/index.ts', name: 'format', head: { declaredIn: 'src/new.ts', kind: 'function' },
    consumers: { items: [{ path: 'src/use.ts', via: 'name' }] } }];
  const result = callSites(items, stored, new Map(Object.entries(sources)));
  assert.deepEqual(result.sites.map(({ path, args, arity, likelyBreak }) => ({ path, args, arity, likelyBreak })),
    [{ path: 'src/use.ts', args: 1, arity: { min: 2, max: 2 }, likelyBreak: true }]);
});

test('namespace type members and literal element calls are consumer uses', () => {
  const sources = { 'src/a.ts': 'export type Options = string;\nexport function format(a: string): string { return a; }',
    'src/use.ts': "import * as ns from './a';\nconst options: ns.Options = 'x';\nns['format']('a', 'b');" };
  const stored = head(sources), consumers = { items: [{ path: 'src/use.ts', via: 'namespace' }] };
  const items = ['Options', 'format'].map((name) => ({ group: 'module', status: 'CHANGED', path: 'src/a.ts', name, consumers }));
  const result = callSites(items, stored, new Map(Object.entries(sources)));
  assert.deepEqual(result.sites.map(({ export: item, use, args, likelyBreak }) => [item.name, use, args, likelyBreak]),
    [['format', 'call', 2, true], ['Options', 'type', null, null]]);
});

test('when Git cannot read the change, the impact section is UNAVAILABLE with the error, and the summary still works', () => {
  const analysis = { files: [], api: { schemaVersion: 2, entryPoints: { files: [], unresolved: [] }, files: {}, testImports: [] } };
  const stored = { id: 'A-0000000000000001', inputs: { repository: '/nonexistent/code-map-repository', selector: { worktree: false } }, data: { sha: 'a'.repeat(40), analysis } };
  const base = { id: 'A-0000000000000002', data: { sha: 'b'.repeat(40), ref: 'main', analysis }, inputs: { selector: { worktree: false } } };
  const context = { id: stored.id, command: (args) => args.join(' '), comparison: { base, renames: [], complete: true, result: { state: 'COMPARABLE', reasons: [] } } };
  const impact = impactSummary(stored, context);
  assert.deepEqual([impact.state, impact.reasons, impact.changed, impact.affected, impact.calls], ['UNAVAILABLE', ['git-unreadable'], null, null, null]);
  assert.match(impact.error, /git diff failed/);
});
