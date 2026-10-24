// Revision binding is checked with real report files and real Git source changes.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildManifest } from '../lib/manifest.mjs';
import { analysisInputs } from '../lib/inputs.mjs';
import { loadReports } from '../lib/verify-reports.mjs';
import { loadConfig } from '../lib/project.mjs';
import { changedCoverage } from '../lib/changed-coverage.mjs';
import { project } from './worker-fixtures.mjs';

const location = { start: { line: 1, column: 0 }, end: { line: 1, column: 20 } };
const entry = { path: 'src/sum.mjs', statementMap: { 0: location }, s: { 0: 1 }, fnMap: {}, f: {}, branchMap: {}, b: {} };
test('coverage accepts its exact source and rejects changed revision and uncommitted source bytes', (t) => {
  const f = project(t), config = loadConfig(f.root);
  f.put('reports/coverage.json', JSON.stringify({ 'src/sum.mjs': entry }));
  const manifest = buildManifest(f.root, config, { artifact: 'reports/coverage.json', kind: 'istanbul-json', exitStatus: '0', command: ['vitest', 'run', '--coverage'] });
  f.put('reports/manifest.json', JSON.stringify(manifest));
  const load = () => {
    const inputs = analysisInputs(f.root, config, { worktree: true }, null);
    const side = { inputs, sha: inputs.sha, analysis: {} };
    return loadReports(f.root, [{ artifact: 'reports/coverage.json', manifest: 'reports/manifest.json' }], { head: side, base: side });
  };
  const bound = load();
  assert.equal(bound.executions[0].binding, 'BOUND');
  assert.equal(bound.executions[0].eligible, true);
  assert.deepEqual(changedCoverage(new Map([['src/sum.mjs', [1]]]), bound.coverage).changedStatements, { covered: 1, total: 1 });
  f.put('src/sum.mjs', 'export function sum(a,b) { return a-b; }');
  const dirty = load();
  assert.equal(dirty.executions[0].binding, 'STALE');
  assert.equal(dirty.executions[0].eligible, false);
  assert.ok(dirty.executions[0].reasons.some(reason => reason.key === 'worktree'));
  assert.deepEqual(dirty.coverage, []);
  f.git('add', 'src/sum.mjs'); f.git('commit', '-qm', 'new source revision');
  const revised = load();
  assert.notEqual(f.git('rev-parse', 'HEAD'), manifest.source.sha);
  assert.equal(revised.executions[0].binding, 'STALE');
  assert.equal(revised.executions[0].eligible, false);
  assert.ok(revised.executions[0].reasons.some(reason => reason.key === 'sha'));
  assert.deepEqual(revised.coverage, []);
});
