// Public commands and report binding use real temporary repositories.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { authorize, project, sandboxed } from './worker-fixtures.mjs';
const cli = fileURLToPath(new URL('../bin/code-map.mjs', import.meta.url));
const code = (f, args) => spawnSync(process.execPath, [cli, ...args], { cwd: f.root, encoding: 'utf8', timeout: 30000 });
const request = (f, reports) => {
  const path = join(f.work, 'request.json');
  writeFileSync(path, JSON.stringify({ requestType: 'code-map-verification-request', schemaVersion: 1, base: 'base', head: 'worktree',
    intent: 'Change a boolean.', acceptanceCriteria: [], allowedPaths: ['src/**'], changeType: 'other', profileId: 'static-baseline-v0',
    ratingRulesVersion: 'ratings-v0', reportInputs: reports,
    execution: { enabled: false, authorization: null, budgets: { wallClockSeconds: 60, memoryMegabytes: 512, outputMegabytes: 8, concurrency: 1 } } }));
  return path;
};
test('manifest accepts stryker-json and verify lists changed survivors without changing ratings', (t) => {
  const f = project(t);
  f.put('src/sum.mjs', 'export function sum(a,b) { const unused = true; return a+b; }\n');
  const mutant = { id: '0', status: 'Survived', mutatorName: 'BooleanLiteral', location: { start: { line: 1, column: 39 }, end: { line: 1, column: 43 } } };
  f.put('reports/mutation.json', JSON.stringify({ files: { 'src/sum.mjs': { mutants: [mutant] } } }));
  const manifest = code(f, ['manifest', '--artifact', 'reports/mutation.json', '--kind', 'stryker-json', '--exit-status', '0', '--out', 'reports/manifest.json', '--', 'stryker', 'run']);
  assert.equal(manifest.status, 0, manifest.stderr);
  const verify = (reports) => {
    const ran = code(f, ['verify', '--request', request(f, reports), '--store', f.store]);
    assert.notEqual(ran.status, 4, ran.stderr);
    return { summary: JSON.parse(ran.stdout), results: JSON.parse(readFileSync(JSON.parse(ran.stdout).files.results, 'utf8')) };
  };
  const empty = verify([]), bound = verify([{ artifact: 'reports/mutation.json', manifest: 'reports/manifest.json' }]);
  assert.equal(bound.results.executions[0].binding, 'BOUND');
  assert.equal(bound.results.mutation[0].counts.survived, 1);
  assert.match(readFileSync(bound.summary.files.report, 'utf8'), /src\/sum.mjs.*BooleanLiteral/);
  assert.deepEqual(bound.results.ratings, empty.results.ratings);
  f.put('src/sum.mjs', 'export function sum(a,b) { return a+b+1; }\n');
  const stale = verify([{ artifact: 'reports/mutation.json', manifest: 'reports/manifest.json' }]);
  assert.equal(stale.results.executions[0].binding, 'STALE');
  assert.deepEqual(stale.results.mutation, []);
});
test('mutate requires authorization and rejects unsupported selectors', (t) => {
  const f = project(t);
  const missing = code(f, ['mutate', '--base', 'base', '--max', '1', '--', process.execPath, '--test']);
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /authorization/);
  const invalid = code(f, ['mutate', '--base', 'base', '--max', '0', '--', process.execPath, '--test']);
  assert.equal(invalid.status, 1);
  assert.match(invalid.stderr, /--max/);
});
test('mutate runs the exact authorized command through the public CLI', sandboxed, (t) => {
  const f = project(t), command = [process.execPath, '--test'];
  f.put('src/sum.mjs', 'export function sum(a,b) { const unused = true; return a+b; }\n');
  const id = authorize(f, command);
  const ran = code(f, ['mutate', '--store', f.store, '--authorization', id, '--base', 'base', '--worktree', '--max', '1', '--seed', '7', '--', ...command]);
  assert.equal(ran.status, 0, ran.stderr);
  const result = JSON.parse(ran.stdout);
  assert.deepEqual([result.selected, result.seed], [1, 7]);
  assert.equal(JSON.parse(readFileSync(result.files.artifact, 'utf8')).files['src/sum.mjs'].mutants[0].status, 'Survived');
});
