// Measured coverage information stays separate from rating inputs.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { istanbulCoverage, changedCoverage, lcovCoverage } from '../lib/changed-coverage.mjs';
import { projectCoverage, coverageLoss, executedExports } from '../lib/coverage-evidence.mjs';
import { decodeSourceMap } from '../lib/source-map.mjs';
const options = { repository: '/repo' };
const loc = (line, column = 0) => ({ start: { line, column }, end: { line, column: column + 1 } });
const report = (path = 'dist/a.js') => ({ path, statementMap: { 0: loc(1) }, s: { 0: 0 },
  fnMap: { 0: { name: 'a', decl: loc(1), loc: loc(1) } }, f: { 0: 0 },
  branchMap: { 0: { type: 'if', loc: loc(1), locations: [loc(1)] } }, b: { 0: [0] } });
const read = (entry) => istanbulCoverage(JSON.stringify({ [entry.path]: entry }), options);
const lcov = (hits, line = 2, branch = 1) => ({ artifact: 'coverage.info', ...lcovCoverage(`SF:src/a.ts\nDA:${line},${hits}\nBRDA:${line},0,0,${branch}\nend_of_record\n`, options) });

test('VLQ decoding maps columns and refuses malformed or unsupported maps', () => {
  const decoded = decodeSourceMap({ version: 3, sources: ['../src/a.ts'], names: [], mappings: 'AAIA,KAAK' }, 'dist/a.js');
  assert.deepEqual(decoded.position({ line: 1, column: 5 }), { path: 'src/a.ts', line: 5, column: 5 });
  assert.equal(decodeSourceMap({ version: 3, sources: ['a'], mappings: '?' }, 'a.js').ok, false);
  assert.equal(decodeSourceMap({ version: 3, sections: [] }, 'a.js').ok, false);
});
test('Istanbul maps statements, branches and functions before the changed-line join', () => {
  const measured = read({ ...report(), inputSourceMap: { version: 3, sources: ['../src/a.ts'], names: [], mappings: 'AAIA' } });
  assert.equal(measured.error, undefined);
  assert.deepEqual([...measured.files.keys()], ['src/a.ts']);
  const changed = changedCoverage(new Map([['src/a.ts', [5]]]), [measured], [{ path: 'src/a.ts', name: 'a', start: 5, column: 0, end: 5 }]);
  assert.deepEqual([changed.changedStatements, changed.changedBranches, changed.changedFunctions], Array(3).fill({ covered: 0, total: 1 }));
  assert.equal(changed.joins.exact, 1);
});
test('project totals include unchanged files and page details without truncating totals', () => {
  const measured = read(report('src/a.ts'));
  const page = projectCoverage([lcov(1), measured], { offset: 0, limit: 1 });
  assert.deepEqual(page.totals, { lines: { covered: 1, total: 1 }, statements: { covered: 0, total: 1 }, branches: { covered: 0, total: 1 }, functions: { covered: 0, total: 1 } });
  assert.equal(page.files.total, 1);
  assert.equal(projectCoverage([lcov(1)], { offset: 1, limit: 1 }).files.details.length, 0);
});
test('adjusted base lines identify lost coverage and exclude changed lines', () => {
  const patch = 'diff --git a/src/a.ts b/src/a.ts\n--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1,0 +2 @@\n+// inserted\n';
  const lost = coverageLoss(patch, [lcov(1, 2, 1)], [lcov(0, 3, 0)]);
  assert.deepEqual(lost.files.details[0].lines, [{ base: 2, head: 3 }]);
  assert.equal(lost.totals.branches, 1);
  assert.equal(coverageLoss(patch, [lcov(1, 2)], [lcov(0, 2)]).totals.lines, 0);
});
test('columns resolve same-line functions and only measured unexecuted exports appear', () => {
  const entry = report('src/a.ts');
  entry.fnMap[1] = { name: 'b', decl: loc(1, 20), loc: loc(1, 20) }; entry.f[1] = 1;
  const measured = read(entry), functions = [{ path: entry.path, name: 'a', start: 1, end: 1, column: 0, exported: true },
    { path: entry.path, name: 'b', start: 1, end: 1, column: 20, exported: true }, { path: entry.path, name: 'absent', start: 9, exported: true }];
  assert.equal(changedCoverage(new Map([[entry.path, [1]]]), [measured], functions).joins.exact, 2);
  const exports = executedExports([measured], functions);
  assert.equal(exports.evidence, 'measured function hits');
  assert.deepEqual(exports.details.map((item) => item.name), ['a']);
});

test('source maps expose unsupported maps and unmapped or escaping sources without generated evidence', () => {
  const unsupported = read({ ...report(), inputSourceMap: { version: 3, sections: [] } });
  assert.equal(unsupported.mappingErrors.length, 1);
  assert.equal(unsupported.files.size, 0);
  const escaping = read({ ...report(), inputSourceMap: { version: 3, sources: ['../../outside.ts'], mappings: 'AAAA' } });
  assert.equal(escaping.outside, 1);
  assert.equal(escaping.files.size, 0);
  const blank = read({ ...report(), inputSourceMap: { version: 3, sources: ['../src/a.ts'], mappings: 'A' } });
  assert.equal(blank.unmapped, 3);
});
test('VLQ state carries signed original deltas across generated lines and unmapped segments', () => {
  const decoded = decodeSourceMap({ version: 3, sources: ['a.ts', 'b.ts'], mappings: 'ACIE;ADDD,C' }, 'out.js');
  assert.deepEqual(decoded.position({ line: 1, column: 0 }), { path: 'b.ts', line: 5, column: 2 });
  assert.deepEqual(decoded.position({ line: 2, column: 0 }), { path: 'a.ts', line: 4, column: 1 });
  assert.equal(decoded.position({ line: 2, column: 1 }), null);
});
test('project pages cap files and preserve complete totals', () => {
  const files = new Map(Array.from({ length: 65 }, (_, index) => [`src/${index}.ts`, { lines: new Map([[1, 1]]), branches: new Map(), functions: null }]));
  const reports = [{ kind: 'lcov', files }], first = projectCoverage(reports, { limit: 1000 });
  assert.equal(first.files.details.length, 50);
  assert.equal(first.files.total, 65);
  assert.equal(first.files.nextOffset, 50);
  assert.equal(first.totals.lines.total, 65);
  assert.equal(projectCoverage(reports, { offset: 50 }).files.details.length, 15);
});
test('coverage loss excludes changed ranges and compares deletions and rename paths', () => {
  const patch = 'diff --git a/old.ts b/src/a.ts\n--- a/old.ts\n+++ b/src/a.ts\n@@ -1 +0,0 @@\n-deleted\n';
  const before = lcov(1, 3), after = lcov(0, 2, 0);
  before.files.set('old.ts', before.files.get('src/a.ts')); before.files.delete('src/a.ts');
  assert.equal(coverageLoss(patch, [before], [after]).totals.lines, 1);
});

test('Istanbul branch loss maps its anchor separately from the arm and excludes edits inside its range', () => {
  const before = report('src/a.ts');
  before.branchMap[0] = { type: 'if', loc: { start: { line: 2, column: 0 }, end: { line: 4, column: 1 } }, locations: [loc(3)] };
  before.b[0] = [1];
  const after = report('src/a.ts');
  after.branchMap[0] = { type: 'if', loc: { start: { line: 3, column: 0 }, end: { line: 5, column: 1 } }, locations: [loc(4)] };
  const insertion = 'diff --git a/src/a.ts b/src/a.ts\n--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1,0 +2 @@\n+inserted\n';
  assert.equal(coverageLoss(insertion, [read(before)], [read(after)]).totals.branches, 1);
  const edited = 'diff --git a/src/a.ts b/src/a.ts\n--- a/src/a.ts\n+++ b/src/a.ts\n@@ -3 +3 @@\n-old\n+new\n';
  assert.equal(coverageLoss(edited, [read(before)], [read(before)]).totals.branches, 0);
});

test('coverage functions include local export aliases and exclude methods of private classes', async () => {
  const { coverageFunctions } = await import('../lib/coverage-evidence.mjs');
  const values = { start: 1, end: 1, column: 0, cyclomatic: 1 };
  const functions = coverageFunctions([{ path: 'a.ts', exports: [{ localName: 'f', name: 'renamed', typeOnly: false }], declarations: [
    { name: 'f', exported: false, complexity: values }, { name: 'Internal', exported: false },
    { name: 'Internal.method', exported: true, complexity: values },
  ] }]);
  assert.deepEqual(functions.map((fn) => [fn.name, fn.exported]), [['f', true], ['Internal.method', false]]);
});

test('a pure rename without hunks still compares unchanged source coordinates', () => {
  const before = lcov(1, 3, 1), after = lcov(0, 3, 0);
  before.files.set('old.ts', before.files.get('src/a.ts')); before.files.delete('src/a.ts');
  const patch = 'diff --git a/old.ts b/src/a.ts\nsimilarity index 100%\nrename from old.ts\nrename to src/a.ts\n';
  assert.deepEqual(coverageLoss(patch, [before], [after]).totals, { lines: 1, branches: 1 });
});

test('an absolute source path stays absolute when the map also supplies sourceRoot', () => {
  const decoded = decodeSourceMap({ version: 3, sources: ['/repo/src/a.ts'], sourceRoot: 'ignored', mappings: 'AAAA' }, 'dist/a.js');
  assert.deepEqual(decoded.position({ line: 1, column: 0 }), { path: '/repo/src/a.ts', line: 1, column: 0 });
});

test('report columns cannot resolve a collision when the analysis has no columns', () => {
  const entry = report('src/a.ts');
  entry.fnMap[1] = { name: 'unknown', decl: loc(1, 20), loc: loc(1, 20) }; entry.f[1] = 1;
  const measured = read(entry), functions = [{ path: entry.path, name: 'a', start: 1, end: 1, exported: true }];
  assert.deepEqual(changedCoverage(new Map([[entry.path, [1]]]), [measured], functions).joins, { exact: 0, ambiguous: 2, missing: 0 });
  assert.equal(executedExports([measured], functions).measured, 0);
});
