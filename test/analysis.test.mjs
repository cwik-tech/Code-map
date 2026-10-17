import assert from 'node:assert/strict';
import { test } from 'node:test';
import { analyzeFile, createResolver } from '../lib/analyze.mjs';
import { analyzeProject, createReport } from '../lib/analysis.mjs';

function data(sources, tests = {}) {
  const resolve = createResolver(new Set([...Object.keys(sources), ...Object.keys(tests)]), { aliases: [], baseUrl: null });
  const facts = (entries) => Object.entries(entries).map(([path, source]) => analyzeFile(path, source, resolve));
  return { project: 'fixture', ref: 'working tree', sha: 'fixture', coverageSnapshot: 'working-tree',
    files: facts(sources), testFiles: facts(tests), coChanges: { changes: { 'src/parent.ts': 3 } }, changes: { uncommitted: ['src/parent.ts'] } };
}

test('all-dependency cycles retain type evidence while value cycles include side effects and dynamic edges', () => {
  const d = data({
    'src/a.ts': "import type { B } from './b'; export interface A {}",
    'src/b.ts': "import { type A } from './a'; export interface B {}",
    'src/c.ts': "import './d'; export const c = 1;",
    'src/d.ts': "export const load = () => import('./c');",
  });
  const a = analyzeProject(d);
  assert.deepEqual(a.cycles.all.map(g => g.files), [['src/a.ts', 'src/b.ts'], ['src/c.ts', 'src/d.ts']]);
  assert.deepEqual(a.cycles.value.map(g => g.files), [['src/c.ts', 'src/d.ts']]);
  assert.deepEqual(a.cycles.all[0].edges.map(e => [e.source, e.target, e.kind, e.line]), [
    ['src/a.ts', 'src/b.ts', 'type', 1], ['src/b.ts', 'src/a.ts', 'side-effect', 1],
  ]);
});

test('shared-type candidates name the declaration and both sides of parent-child evidence', () => {
  const a = analyzeProject(data({
    'src/parent.ts': "import { child } from './child';\nexport interface Shared {}\nexport const parent = child;",
    'src/child.ts': "import type { Shared } from './parent';\nexport function child(input: Shared) { return input; }",
  }));
  assert.deepEqual(a.sharedTypes, [{ owner: 'src/parent.ts', name: 'Shared', line: 2,
    consumers: [{ path: 'src/child.ts', line: 1, parentImportLine: 1 }] }]);
});

test('export usage separates test-only, local references, aliases and primitive vendor candidates', () => {
  const a = analyzeProject(data({
    'src/a.ts': 'export interface Shape {}\nexport function local() { return 1; }\nexport const used = local();\nexport { local as renamed };',
    'src/b.ts': "import { used } from './a';",
    'ui/src/components/ui/button.tsx': 'export const unusedPrimitive = 1;',
  }, { 'test/a.test.ts': "import type { Shape } from '../src/a';" }));
  const exports = a.files.find(f => f.path === 'src/a.ts').exports;
  assert.deepEqual(exports.map(e => [e.name, e.category, e.usage]), [
    ['Shape', 'type', 'test-only'], ['local', 'value', 'unreferenced'], ['used', 'value', 'source'], ['renamed', 'reexport', 'unreferenced'],
  ]);
  assert.equal(exports[1].localReferences, 1);
  assert.equal(a.files.find(f => f.path.includes('/ui/')).vendorCandidate, true);
});

test('compact reports retain selected evidence and distinguish direct tests from tests reaching through helpers', () => {
  const d = data({ 'src/a.ts': 'export const run = 1;', 'src/b.ts': "import { run } from './a';" }, {
    'test/helpers.ts': "import { run } from '../src/a';", 'test/a.test.ts': "import './helpers';", 'test/direct.test.ts': "import { run } from '../src/a';",
  });
  d.analysis = analyzeProject(d);
  const report = createReport(d, { files: ['src/a.ts'] });
  assert.deepEqual(report.files[0].tests, { direct: ['test/direct.test.ts'], transitive: ['test/a.test.ts'] });
  assert.deepEqual(report.files[0].importers, ['src/b.ts']);
  assert.equal(report.files[0].source, undefined);
  assert.equal(report.schemaVersion, 1);
  assert.throws(() => createReport(d, { files: ['src/no.ts'] }), /src\/no.ts/);
  assert.throws(() => createReport(d, { change: 'typo' }), /change/);
});

test('wildcard reexports with unresolved symbol exposure are not classified as unused declarations', () => {
  const a = analyzeProject(data({
    'src/a.ts': 'export const value = 1;',
    'src/barrel.ts': "export * from './a';",
    'src/consumer.ts': "import { value } from './barrel';",
  }));
  assert.equal(a.files.find(f => f.path === 'src/barrel.ts').exports[0].usage, 'unknown');
});
