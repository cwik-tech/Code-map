// code-map manifest writes the run manifest of a test report that the user's own test run wrote. verify then accepts the
// report as bound evidence. The command runs no project code: the words after "--" are only recorded.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateManifest } from '../lib/adapters/run-manifest.mjs';
import { analysisInputs } from '../lib/inputs.mjs';
import { loadConfig } from '../lib/project.mjs';
import { loadReports } from '../lib/verify-reports.mjs';

const cli = fileURLToPath(new URL('../bin/code-map.mjs', import.meta.url));
const junit = (failed) => '<?xml version="1.0"?>\n<testsuites><testsuite name="test/engine.test.ts" tests="1" failures="' + (failed ? 1 : 0) + '">'
  + '<testcase classname="test/engine.test.ts" file="test/engine.test.ts" name="engine returns one">' + (failed ? '<failure message="expected 2 to be 1"/>' : '') + '</testcase></testsuite></testsuites>\n';

function project(t) {
  const root = mkdtempSync(join(tmpdir(), 'code-map-manifest-')), work = mkdtempSync(join(tmpdir(), 'code-map-manifest-work-'));
  t.after(() => { rmSync(root, { recursive: true, force: true }); rmSync(work, { recursive: true, force: true }); });
  const put = (path, text) => { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), text); };
  const git = (...args) => execFileSync('git', ['-C', root, '-c', 'user.name=test', '-c', 'user.email=test@example.com', ...args], { encoding: 'utf8' }).trim();
  put('.gitignore', 'reports/\n'); put('package-lock.json', '{"lockfileVersion":3}\n');
  put('src/core/engine.ts', 'export function engine() { return 1; }\n');
  put('test/engine.test.ts', "import { test, expect } from 'vitest';\nimport { engine } from '../src/core/engine';\ntest('engine returns one', () => { expect(engine()).toBe(1); });\n");
  git('init', '-q', '-b', 'main'); git('add', '.'); git('commit', '-qm', 'base'); git('tag', 'base');
  const run = (args) => spawnSync(process.execPath, [cli, ...args], { cwd: root, encoding: 'utf8', timeout: 60000 });
  return { root, work, put, git, run };
}

test('code-map manifest writes a valid manifest that binds a failing report of the working tree, and verify then blocks the change', (t) => {
  const { root, work, put, run } = project(t);
  put('src/core/engine.ts', 'export function engine() { return 2; }\n');
  put('reports/junit.xml', junit(true));
  const written = run(['manifest', '--artifact', 'reports/junit.xml', '--kind', 'junit', '--exit-status', '1', '--out', 'reports/junit.manifest.json', '--', 'npx', 'vitest', 'run', '--reporter=junit']);
  assert.equal(written.status, 0, written.stderr);
  const manifest = JSON.parse(readFileSync(join(root, 'reports/junit.manifest.json'), 'utf8'));
  assert.equal(validateManifest(manifest).ok, true);
  assert.deepEqual(manifest.command, ['npx', 'vitest', 'run', '--reporter=junit']);
  assert.equal(manifest.environment.policy, 'self-attested');
  assert.equal(manifest.environment.architecture, process.arch);
  assert.equal(manifest.environment.typescript, '6.0.3');
  assert.equal(typeof manifest.environment.osVersion, 'string');
  assert.equal(typeof manifest.environment.os, 'string');
  assert.match(manifest.source.worktreeDigest, /^[0-9a-f]{64}$/, 'the working tree has a change, so it has a digest');

  const request = join(work, 'request.json');
  writeFileSync(request, JSON.stringify({ requestType: 'code-map-verification-request', schemaVersion: 1, base: 'base', head: 'worktree', intent: 'Change the engine.',
    acceptanceCriteria: [], allowedPaths: ['src/**', 'test/**'], changeType: 'other', profileId: 'static-baseline-v0', ratingRulesVersion: 'ratings-v0',
    reportInputs: [{ artifact: 'reports/junit.xml', manifest: 'reports/junit.manifest.json' }],
    execution: { enabled: false, authorization: null, budgets: { wallClockSeconds: 60, memoryMegabytes: 512, outputMegabytes: 8, concurrency: 1 } } }));
  const verified = run(['verify', '--request', request, '--store', join(work, 'store'), '--out-dir', join(work, 'out')]);
  assert.equal(verified.status, 2, verified.stderr);
  const results = JSON.parse(readFileSync(JSON.parse(verified.stdout).files.results, 'utf8'));
  assert.deepEqual(results.executions.map((item) => [item.binding, item.eligible, item.side]), [['BOUND', true, 'head']]);
});

/** A request of the working tree with these report pairs, in the work folder outside the repository. */
function requestFile(work, reportInputs) {
  const path = join(work, `request-${reportInputs.length}-${Date.now()}.json`);
  writeFileSync(path, JSON.stringify({ requestType: 'code-map-verification-request', schemaVersion: 1, base: 'base', head: 'worktree', intent: 'Change the engine.',
    acceptanceCriteria: [], allowedPaths: ['src/**', 'test/**'], changeType: 'other', profileId: 'static-baseline-v0', ratingRulesVersion: 'ratings-v0', reportInputs,
    execution: { enabled: false, authorization: null, budgets: { wallClockSeconds: 60, memoryMegabytes: 512, outputMegabytes: 8, concurrency: 1 } } }));
  return path;
}
/** Writes a compiler report and its run manifest with code-map manifest. Returns the pair for reportInputs. */
function compiled({ put, run }, name, text, exitStatus) {
  const artifact = `reports/${name}.txt`, manifest = `reports/${name}.manifest.json`;
  put(artifact, text);
  const written = run(['manifest', '--artifact', artifact, '--kind', 'tsc', '--exit-status', String(exitStatus), '--out', manifest, '--', 'npx', 'tsc', '--noEmit', '--pretty', 'false']);
  assert.equal(written.status, 0, written.stderr);
  return { artifact, manifest };
}
const verifyRun = ({ work, run }, inputs) => {
  const output = run(['verify', '--request', requestFile(work, inputs), '--store', join(work, 'store'), '--out-dir', join(work, 'out')]);
  const summary = JSON.parse(output.stdout || '{}'), results = summary.files ? JSON.parse(readFileSync(summary.files.results, 'utf8')) : null;
  return { output, summary, results, byId: Object.fromEntries((results?.obligations ?? []).map((item) => [item.id, item])) };
};

test('code-map manifest writes a manifest for a TypeScript compiler report, and verify fails the type check for an error in a changed file', (t) => {
  const fixture = project(t), { root, put } = fixture;
  put('src/core/engine.ts', "export function engine(): number { return '2'; }\n");
  const pair = compiled(fixture, 'tsc', "src/core/engine.ts(1,43): error TS2322: Type 'string' is not assignable to type 'number'.\n", 2);
  const manifest = JSON.parse(readFileSync(join(root, pair.manifest), 'utf8'));
  assert.equal(validateManifest(manifest).ok, true);
  assert.deepEqual([manifest.artifacts[0].kind, manifest.exitStatus, manifest.command], ['tsc', 2, ['npx', 'tsc', '--noEmit', '--pretty', 'false']]);

  const { output, summary, results, byId } = verifyRun(fixture, [pair]);
  assert.equal(output.status, 3, output.stderr);
  assert.deepEqual(results.executions.map(({ kind, side, binding, eligible, cases, errors, outside }) => ({ kind, side, binding, eligible, cases, errors, outside })),
    [{ kind: 'tsc', side: 'head', binding: 'BOUND', eligible: true, cases: null, errors: 1, outside: 0 }]);
  assert.equal(byId['structure.types-compatible'].result, 'FAIL');
  assert.deepEqual(byId['structure.types-compatible'].evidenceIds, ['diagnostic:reports/tsc.txt:src/core/engine.ts:1:43:TS2322']);
  assert.ok(summary.failed.includes('structure.types-compatible'));
  assert.equal(byId['coverage.head-run'].result, 'UNKNOWN', 'a compiler report is not a test report');
  assert.match(readFileSync(summary.files.report, 'utf8'), /\| `reports\/tsc\.txt` \(tsc\) \| Head \| Yes, self-attested \| 1 error \|/);
});

test('a compiler report with exit status 0 and an error does not count, and an error only in an unrelated file passes with 3 of 5', (t) => {
  const fixture = project(t), { put, git } = fixture;
  put('src/util/other.ts', 'export const other = 1;\n');
  git('add', '.'); git('commit', '-qm', 'other'); git('tag', '-f', 'base');
  put('src/core/engine.ts', 'export function engine(): number { return 2; }\n');
  const disagrees = compiled(fixture, 'disagrees', "src/core/engine.ts(1,1): error TS2322: Type 'string' is not assignable to type 'number'.\n", 0);
  const unrelated = compiled(fixture, 'unrelated', "src/util/other.ts(1,14): error TS2322: Type 'number' is not assignable to type 'string'.\n../outside/x.ts(1,1): error TS2307: Cannot find module.\n", 2);
  const { output, summary, results, byId } = verifyRun(fixture, [disagrees, unrelated]);
  assert.equal(output.status, 3, output.stderr);
  const [first, second] = results.executions;
  assert.deepEqual([first.binding, first.eligible, first.reasons.map((reason) => reason.key)], ['BOUND', false, ['exit-status']]);
  assert.match(first.reasons[0].message, /exit status 0, but the report has error diagnostics/);
  assert.deepEqual([second.eligible, second.errors, second.outside], [true, 2, 1]);
  assert.equal(byId['structure.types-compatible'].result, 'PASS');
  assert.match(byId['structure.types-compatible'].rationale, /1 error is in other files\. Code-map ignored 1 diagnostic outside the repository\./);
  assert.deepEqual(summary.ratings.structuralIntegrity, { state: 'RATED', value: 3, label: 'Adequate' });
});

test('the compiler reports of one request have a total limit on diagnostics, and they never go into the lists of the test reports', (t) => {
  const fixture = project(t), { root } = fixture, line = (n) => `src/core/engine.ts(${n},1): error TS2322: Type mismatch.`;
  const inputs = [compiled(fixture, 'one', `${line(1)}\n`, 2), compiled(fixture, 'two', `${line(1)}\n${line(2)}\n`, 2)];
  const inputsOf = analysisInputs(root, loadConfig(root), { worktree: true }, null), side = { inputs: inputsOf, sha: inputsOf.sha, analysis: { tests: { testFiles: [] } } };
  const loaded = loadReports(root, inputs, { head: side, base: side }, { reports: 9, bytes: 1048576, cases: 9, diagnostics: 2 });
  assert.deepEqual(loaded.executions.map((item) => [item.eligible, item.errors, item.reasons.map((reason) => reason.key)]), [[true, 1, []], [false, 2, ['limit']]]);
  assert.match(loaded.executions[1].reasons[0].message, /more than 2 compiler diagnostics\. .* so this report does not count\.$/);
  assert.deepEqual([loaded.compiler.head.length, loaded.reports.head.length, loaded.reports.base.length], [1, 0, 0]);
});

test('code-map manifest writes a valid manifest for an LCOV coverage report of the kind lcov', (t) => {
  const { root, put, run } = project(t);
  put('reports/lcov.info', `SF:${join(root, 'src/core/engine.ts')}\nDA:1,1\nend_of_record\n`);
  const written = run(['manifest', '--artifact', 'reports/lcov.info', '--kind', 'lcov', '--exit-status', '0', '--', 'npx', 'vitest', 'run', '--coverage']);
  assert.equal(written.status, 0, written.stderr);
  const manifest = JSON.parse(written.stdout);
  assert.equal(validateManifest(manifest).ok, true);
  assert.deepEqual(manifest.artifacts.map((item) => [item.path, item.kind]), [['reports/lcov.info', 'lcov']]);
  assert.equal(manifest.source.worktreeDigest, null, 'Git ignores the report, so the working tree is the commit');
  assert.match(run(['manifest', '--artifact', 'reports/lcov.info', '--kind', 'cobertura', '--exit-status', '0', '--', 'npm', 'test']).stderr, /--kind must be one of .*lcov/);
});

test('a run manifest can name the backend of an isolated run, and the backend must be a nonempty string', (t) => {
  const { put, run } = project(t);
  put('reports/junit.xml', junit(false));
  const manifest = JSON.parse(run(['manifest', '--artifact', 'reports/junit.xml', '--kind', 'junit', '--exit-status', '0', '--', 'npm', 'test']).stdout);
  assert.equal(Object.hasOwn(manifest.environment, 'backend'), false, 'a self-attested manifest names no backend');
  assert.equal(validateManifest({ ...manifest, environment: { ...manifest.environment, policy: 'isolated', backend: 'seatbelt' } }).ok, true);
  const errors = validateManifest({ ...manifest, environment: { ...manifest.environment, backend: '' } }).errors.map((error) => error.path);
  assert.deepEqual(errors, ['environment.backend']);
});

test('code-map manifest refuses a missing report, an unknown kind or a missing command, and prints nothing', (t) => {
  const { put, run } = project(t);
  put('reports/junit.xml', junit(false));
  for (const [args, pattern] of [[['--artifact', 'reports/missing.xml', '--kind', 'junit', '--exit-status', '0', '--', 'npm', 'test'], /missing\.xml/],
    [['--artifact', 'reports/junit.xml', '--kind', 'tap', '--exit-status', '0', '--', 'npm', 'test'], /--kind/],
    [['--artifact', 'reports/junit.xml', '--kind', 'junit', '--exit-status', '0'], /command/],
    [['--artifact', 'reports/junit.xml', '--kind', 'junit', '--exit-status', 'x', '--', 'npm', 'test'], /--exit-status/]]) {
    const output = run(['manifest', ...args]);
    assert.notEqual(output.status, 0, args.join(' '));
    assert.equal(output.stdout, '');
    assert.match(output.stderr, pattern);
  }
});

test('a manifest invoked below the repository root binds compiler paths to that directory', (t) => {
  const fixture = project(t), { root, put } = fixture;
  put('packages/app/src/engine.ts', 'export const engine = 2;');
  put('reports/nested-tsc.txt', 'src/engine.ts(1,1): error TS2322: Type mismatch.\n');
  const written = spawnSync(process.execPath, [cli, 'manifest', '--artifact', 'reports/nested-tsc.txt', '--kind', 'tsc',
    '--exit-status', '2', '--out', 'reports/nested.manifest.json', '--', 'npx', 'tsc', '--noEmit'],
  { cwd: join(root, 'packages/app'), encoding: 'utf8', timeout: 30000 });
  assert.equal(written.status, 0, written.stderr);
  const manifest = JSON.parse(readFileSync(join(root, 'reports/nested.manifest.json'), 'utf8'));
  assert.equal(manifest.workingDirectory, 'packages/app');
  const { results } = verifyRun(fixture, [{ artifact: 'reports/nested-tsc.txt', manifest: 'reports/nested.manifest.json' }]);
  assert.equal(results.executions[0].eligible, true);
  assert.ok(results.obligations.find((item) => item.id === 'structure.types-compatible').evidenceIds
    .includes('diagnostic:reports/nested-tsc.txt:packages/app/src/engine.ts:1:1:TS2322'));
});
