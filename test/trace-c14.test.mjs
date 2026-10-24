import assert from 'node:assert/strict';
import { test } from 'node:test';
import { diffLines, changedCoverage, istanbulCoverage } from '../lib/changed-coverage.mjs';
const loc = (from, to = from) => ({ start: { line: from, column: 0 }, end: { line: to, column: 10 } });
test('head diff hunks select intersecting executable statement and branch ranges', () => {
  const patch = 'diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -3 +3,2 @@\n-old\n+new\n+// comment\n';
  const entry = { path: 'a.ts', statementMap: { 0: loc(2, 3), 1: loc(5) }, s: { 0: 0, 1: 9 }, fnMap: {}, f: {},
    branchMap: { 0: { type: 'if', loc: loc(2, 3), locations: [loc(2, 3), loc(5)] } }, b: { 0: [0, 9] } };
  const report = istanbulCoverage(JSON.stringify({ 'a.ts': entry }), { repository: '/repo' });
  const measured = changedCoverage(diffLines(patch), [report]);
  assert.deepEqual([...diffLines(patch)], [['a.ts', [3, 4]]]);
  assert.deepEqual(measured.changedStatements, { covered: 0, total: 1 });
  assert.deepEqual(measured.changedBranches, { covered: 0, total: 1 });
  assert.deepEqual(measured.files[0].uncoveredStatements, [2]);
  assert.deepEqual(measured.files[0].uncoveredBranches, ['2:0:0']);
});
