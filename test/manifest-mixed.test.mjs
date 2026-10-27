// One verify request keeps bound test, compiler and coverage evidence separate.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const cli = fileURLToPath(new URL('../bin/code-map.mjs', import.meta.url));

test('one request binds JUnit, tsc and LCOV reports and uses each for its own checks', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'code-map-mixed-')), work = mkdtempSync(join(tmpdir(), 'code-map-mixed-work-'));
  t.after(() => { rmSync(root, { recursive: true, force: true }); rmSync(work, { recursive: true, force: true }); });
  const put = (path, text) => { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), text); };
  const git = (...args) => execFileSync('git', ['-C', root, '-c', 'user.name=test', '-c', 'user.email=test@example.com', ...args], { encoding: 'utf8' });
  const run = (args) => spawnSync(process.execPath, [cli, ...args], { cwd: root, encoding: 'utf8', timeout: 30000 });
  put('.gitignore', 'reports/\n');
  put('src/engine.ts', 'export function engine(): number { return 1; }\n');
  put('test/engine.test.ts', "import { test, expect } from 'vitest';\nimport { engine } from '../src/engine';\ntest('engine returns one', () => { expect(engine()).toBe(1); });\n");
  git('init', '-q'); git('add', '.'); git('commit', '-qm', 'base');
  put('src/engine.ts', "export function engine(): number { return '2'; }\n");
  const pair = (artifact, kind, text, exitStatus, command) => {
    const manifest = `${artifact}.manifest.json`;
    put(artifact, text);
    const output = run(['manifest', '--artifact', artifact, '--kind', kind, '--exit-status', String(exitStatus), '--out', manifest, '--', ...command]);
    assert.equal(output.status, 0, output.stderr);
    return { artifact, manifest };
  };
  const junit = pair('reports/junit.xml', 'junit', '<testsuite name="engine" tests="1" failures="0">'
    + '<testcase file="test/engine.test.ts" name="engine returns one"/></testsuite>\n', 0, ['npx', 'vitest', 'run']);
  const tsc = pair('reports/tsc.txt', 'tsc', "src/engine.ts(1,35): error TS2322: Type 'string' is not assignable to type 'number'.\n",
    2, ['npx', 'tsc', '--noEmit', '--pretty', 'false']);
  const lcov = pair('reports/lcov.info', 'lcov', 'SF:src/engine.ts\nDA:1,0\nend_of_record\n', 0, ['npx', 'vitest', 'run', '--coverage']);
  const request = join(work, 'request.json');
  writeFileSync(request, JSON.stringify({ requestType: 'code-map-verification-request', schemaVersion: 1, base: 'HEAD', head: 'worktree',
    intent: 'Change the engine.', acceptanceCriteria: [], allowedPaths: ['src/**'], changeType: 'other',
    profileId: 'static-baseline-v0', ratingRulesVersion: 'ratings-v0', reportInputs: [junit, tsc, lcov],
    execution: { enabled: false, authorization: null, budgets: { wallClockSeconds: 60, memoryMegabytes: 512, outputMegabytes: 8, concurrency: 1 } } }));
  const output = run(['verify', '--request', request, '--store', join(work, 'store'), '--out-dir', join(work, 'out')]);
  assert.equal(output.status, 3, output.stderr);
  const summary = JSON.parse(output.stdout), results = JSON.parse(readFileSync(summary.files.results, 'utf8'));
  const byId = Object.fromEntries(results.obligations.map((item) => [item.id, item]));
  assert.deepEqual(results.executions.map(({ kind, binding, eligible, side, cases }) => [kind, binding, eligible, side, cases]),
    [['junit', 'BOUND', true, 'head', 1], ['tsc', 'BOUND', true, 'head', null], ['lcov', 'BOUND', true, 'head', null]]);
  assert.deepEqual([byId['structure.types-compatible'].result, byId['structure.types-compatible'].evidenceIds],
    ['FAIL', ['diagnostic:reports/tsc.txt:src/engine.ts:1:35:TS2322']]);
  assert.deepEqual([byId['coverage.head-run'].result, byId['coverage.head-run'].evidenceIds], ['PASS', ['report:reports/junit.xml']]);
  assert.match(byId['coverage.head-run'].rationale, /ran 1 test case/);
  assert.deepEqual([byId['behavior.no-new-failures'].result, byId['behavior.no-new-failures'].evidenceIds], ['PASS', ['report:reports/junit.xml']]);
  assert.deepEqual([byId['behavior.earlier-failures'].result, byId['behavior.earlier-failures'].evidenceIds], ['PASS', ['report:reports/junit.xml']]);
  assert.deepEqual(results.coverage.reports, ['reports/lcov.info']);
  assert.deepEqual(results.coverage.changedLines, { covered: 0, total: 1, share: 0, threshold: 80 });
  assert.equal(results.ratings.verificationCoverage.state, 'RATED');
  assert.ok(results.ratings.verificationCoverage.predicates.unmet.includes('vc.changed-lines-80'));
  assert.deepEqual(results.ratings.verificationCoverage.predicateEvidence['vc.changed-lines-80'], ['report:reports/lcov.info']);
});
