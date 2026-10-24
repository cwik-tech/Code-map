import assert from 'node:assert/strict';
import { test } from 'node:test';
import { changedCoverage, istanbulCoverage } from '../lib/changed-coverage.mjs';
const loc = { start: { line: 1, column: 0 }, end: { line: 1, column: 1 } };
test('mapped function coordinates join the original AST symbol rather than the generated symbol', () => {
  const entry = { path: 'dist/a.js', statementMap: {}, s: {}, branchMap: {}, b: {},
    fnMap: { 0: { name: 'minified', decl: loc, loc } }, f: { 0: 7 },
    inputSourceMap: { version: 3, sources: ['../src/a.ts'], names: [], mappings: 'AAIA' } };
  const report = istanbulCoverage(JSON.stringify({ 'dist/a.js': entry }), { repository: '/repo' });
  const measured = changedCoverage(new Map([['src/a.ts', [5]]]), [report], [
    { path: 'dist/a.js', name: 'wrong', start: 1, end: 1, column: 0 },
    { path: 'src/a.ts', name: 'original', start: 5, end: 5, column: 0 },
  ]);
  assert.deepEqual(measured.joins, { exact: 1, ambiguous: 0, missing: 0 });
  assert.deepEqual(measured.files[0].functionJoins, [{ name: 'minified', line: 5, covered: true, join: 'exact', analysis: 'original' }]);
});
