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
