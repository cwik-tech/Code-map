// The line coverage of the changed code: the changed lines from a `git diff -U0` patch, the records of an LCOV report with
// repository-relative paths, and the covered and total changed lines and branches. All functions here are pure.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { changedCoverage, coverageSection, diffLines, lcovCoverage } from '../lib/changed-coverage.mjs';
import { parseLcov } from '../lib/coverage.mjs';

const repository = '/work/repo';
const record = (path, lines = [], branches = []) => [`SF:${path}`, ...lines.map(([line, hits]) => `DA:${line},${hits}`),
  ...branches.map(([line, block, branch, taken]) => `BRDA:${line},${block},${branch},${taken}`), 'end_of_record'].join('\n');
const lcov = (...records) => `TN:\n${records.join('\n')}\n`;
const report = (text, fields = {}) => ({ artifact: 'coverage/lcov.info', ...lcovCoverage(text, { repository, ...fields }) });

test('the changed lines of a patch are the added and the modified lines of the head, and a deletion adds none', () => {
  const patch = ['diff --git a/src/a.ts b/src/a.ts', 'index 1..2 100644', '--- a/src/a.ts', '+++ b/src/a.ts', '@@ -2 +2,2 @@ export function a() {', '-  return 1;', '+  return 2;', '+  // two',
    '@@ -9,2 +10,0 @@', '-x', '-y', 'diff --git a/src/new.ts b/src/new.ts', 'new file mode 100644', '--- /dev/null', '+++ b/src/new.ts', '@@ -0,0 +1,3 @@', '+one', '++++ b/fake', '+three',
    '\\ No newline at end of file', 'diff --git a/src/gone.ts b/src/gone.ts', 'deleted file mode 100644', '--- a/src/gone.ts', '+++ /dev/null', '@@ -1,2 +0,0 @@', '-+++ b/src/fake.ts', '-two', ''].join('\n');
  assert.deepEqual([...diffLines(patch)], [['src/a.ts', [2, 3]], ['src/new.ts', [1, 2, 3]]]);
});

test('a context line in a hunk is not a changed line, also an empty one, when a Git setting joins two hunks', () => {
  // diff.interHunkContext=5 joins the hunks of lines 2 and 7. diff.suppressBlankEmpty prints the empty context line 5 as "".
  const patch = ['diff --git a/src/a.ts b/src/a.ts', '--- a/src/a.ts', '+++ b/src/a.ts', '@@ -2,6 +2,7 @@', '-2', '+X', ' 3', ' 4', '', ' 6', '-7', '+Y', '+Z',
    'diff --git a/src/b.ts b/src/b.ts', '--- a/src/b.ts', '+++ b/src/b.ts', '@@ -1 +1 @@', '-a', '+b', ''].join('\n');
  assert.deepEqual([...diffLines(patch)], [['src/a.ts', [2, 7, 8]], ['src/b.ts', [1]]]);
});

test('the patch paths keep their names: a quoted name, a name with a space and a renamed file', () => {
  const patch = ['diff --git "a/src/q\\"z.ts" "b/src/q\\"z.ts"', '--- "a/src/q\\"z.ts"', '+++ "b/src/q\\"z.ts"', '@@ -1,0 +2 @@ x', '+y',
    'diff --git a/src/my file.ts b/src/my file.ts', '--- a/src/my file.ts\t', '+++ b/src/my file.ts\t', '@@ -1 +1 @@', '-a', '+b',
    'diff --git a/src/old.ts b/src/moved.ts', 'similarity index 83%', 'rename from src/old.ts', 'rename to src/moved.ts', '--- a/src/old.ts', '+++ b/src/moved.ts', '@@ -5,0 +6 @@', '+6',
    'diff --git a/src/same.ts b/src/twin.ts', 'similarity index 100%', 'rename from src/same.ts', 'rename to src/twin.ts', ''].join('\n');
  assert.deepEqual([...diffLines(patch)], [['src/q"z.ts', [2]], ['src/my file.ts', [1]], ['src/moved.ts', [6]]]);
});

test('LCOV paths become repository-relative: absolute and relative SF paths, and paths outside the repository are left out and counted', () => {
  const text = lcov(record('/work/repo/src/a.ts', [[1, 1]]), record('lib/b.ts', [[2, 0]]), record('src\\win.ts', [[3, 1]]), record('/work/other/c.ts', [[1, 1]]),
    record('../../../d.ts', [[1, 1]]), record('../../inside.ts', [[2, 1]]), record('C:/elsewhere/e.ts', [[1, 1]]), record('/link/repo/src/linked.ts', [[4, 1]]), record('', [[1, 1]]));
  const real = (path) => path.replace(/^\/link\/repo\//, '/work/repo/');
  const { files, outside } = lcovCoverage(text, { repository, workingDirectory: 'packages/app', real });
  // A relative path is relative to the working directory of the run, so "../../inside.ts" from packages/app is inside the repository.
  assert.deepEqual([...files.keys()], ['src/a.ts', 'packages/app/lib/b.ts', 'packages/app/src/win.ts', 'inside.ts', 'src/linked.ts']);
  assert.equal(outside, 3, 'an empty SF path is not a path outside the repository');
  assert.deepEqual([...files.get('src/a.ts').lines], [[1, 1]]);
});

test('two records of one file are merged: a line or a branch is covered when one record has a count more than 0', () => {
  const text = lcov(record('src/a.ts', [[1, 0], [2, 3]], [[1, 0, 0, '-']]), record('./src/a.ts', [[1, 2], [2, 0]], [[1, 0, 0, '1']]));
  const file = lcovCoverage(text, { repository }).files.get('src/a.ts');
  assert.deepEqual([...file.lines], [[1, 2], [2, 3]]);
  assert.deepEqual([...file.branches], [['1:0:0', { line: 1, taken: 1 }]]);
});

test('parseLcov gives the records in order and leaves out a record whose path the caller refuses', () => {
  const { records, ignored } = parseLcov(lcov(record('src/a.ts', [[1, 4]], [[1, 0, 1, '-']]), record('skip.ts', [[1, 1]])) + 'LF:7\nDA:9,9\n', (path) => path !== 'skip.ts' && path);
  assert.deepEqual(records, [{ path: 'src/a.ts', found: undefined, hit: undefined, lines: [[1, 4]], branches: [[1, 0, 1, 0]], functions: [], calls: [], functionsFound: undefined }]);
  assert.equal(ignored, 1);
  // FN has the start line and the name (LCOV 1), or the start line, the end line and the name (LCOV 2). FNDA gives the count of a name.
  const [functions] = parseLcov('SF:a.ts\nFN:3,go\nFN:5,9,two,parts\nFN:x,bad\nFN:7,\nFNDA:2,go\nFNDA:-1,go\nFNF:2\nFNH:1\nend_of_record\n', (path) => path).records;
  assert.deepEqual([functions.functions, functions.calls, functions.functionsFound], [[[3, null, 'go'], [5, 9, 'two,parts']], [['go', 2]], 2]);
});

test('changed executable lines have a DA record, and changed branches are the BRDA records on changed lines, with "-" as not taken', () => {
  const text = lcov(record('src/a.ts', [[1, 1], [2, 0], [3, 5], [7, 0]], [[2, 0, 0, '1'], [2, 0, 1, '-'], [3, 1, 0, '0'], [7, 2, 0, '4']]));
  // Line 4 changed but has no DA record (a comment), and line 7 has records but did not change.
  const measure = changedCoverage(new Map([['src/a.ts', [1, 2, 3, 4]]]), [report(text)]);
  assert.deepEqual(measure.changedLines, { covered: 2, total: 3 });
  assert.deepEqual(measure.changedBranches, { covered: 1, total: 3 });
  assert.deepEqual(measure.files, [{ path: 'src/a.ts', source: 'lcov', lines: { covered: 2, total: 3 }, branches: { covered: 1, total: 3 }, statements: null, functions: null,
    uncoveredLines: [2], uncoveredBranches: ['2:0:1', '3:1:0'], uncoveredStatements: [], functionJoins: [] }]);
  assert.deepEqual([measure.unmeasured, measure.reports], [[], ['coverage/lcov.info']]);
});

test('a changed code file without an SF record is not measured, and it never counts as covered', () => {
  const text = lcov(record('src/a.ts', [[1, 1]]));
  const measure = changedCoverage(new Map([['src/a.ts', [1]], ['src/b.ts', [1, 2]], ['src/deleted-lines.ts', []]]), [report(text)]);
  assert.deepEqual(measure.changedLines, { covered: 1, total: 1 });
  assert.deepEqual(measure.unmeasured, ['src/b.ts'], 'a file without changed lines needs no measure');
  assert.deepEqual(measure.files.map((file) => file.path), ['src/a.ts']);
});

test('the reports of the head are merged, and the outside paths of all reports are counted', () => {
  const unit = report(lcov(record('src/a.ts', [[1, 0], [2, 1]]), record('/elsewhere/x.ts', [[1, 1]])), { real: (path) => path });
  const integration = { ...report(lcov(record('src/a.ts', [[1, 3]]), record('src/b.ts', [[5, 0]]))), artifact: 'coverage/integration.info' };
  const measure = changedCoverage(new Map([['src/a.ts', [1, 2]], ['src/b.ts', [5]]]), [unit, integration]);
  assert.deepEqual([measure.changedLines, measure.unmeasured, measure.outside], [{ covered: 2, total: 3 }, [], 1]);
  assert.deepEqual(measure.reports, ['coverage/lcov.info', 'coverage/integration.info']);
});

test('the coverage section gives covered, total, share and threshold, and the share rounds down so that it never reaches a threshold early', () => {
  const lines = Array.from({ length: 1000 }, (_, index) => [index + 1, index < 799 ? 1 : 0]);
  const measure = changedCoverage(new Map([['src/a.ts', lines.map(([line]) => line)], ['src/b.ts', [1]]]), [report(lcov(record('src/a.ts', lines)))]);
  const section = coverageSection(measure, { changedLines: 80, changedBranches: 70 });
  assert.equal(section.measure, 'line coverage');
  assert.deepEqual(section.changedLines, { covered: 799, total: 1000, share: 79.9, threshold: 80 });
  assert.deepEqual(section.changedBranches, { covered: 0, total: 0, share: null, threshold: 70, sources: { lcov: 1, 'istanbul-json': 0 }, files: { measured: 1, unmeasured: ['src/b.ts'] } });
  assert.deepEqual([section.lineReports, section.changedStatements, section.changedFunctions], [['coverage/lcov.info'], null, null], 'an LCOV report without FN records gives no statements and no functions');
  assert.deepEqual(section.files, { total: 2, measured: 1, unmeasured: ['src/b.ts'], details: [{ ...measure.files[0], uncoveredLines: measure.files[0].uncoveredLines.slice(0, 20) }] });
  assert.equal(section.outsideRepository, 0);
  assert.deepEqual(coverageSection(measure, undefined).changedLines.threshold, null);
});
