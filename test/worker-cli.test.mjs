// `code-map authorize` and `code-map run` through the CLI: a real `node --test` run with a JUnit report inside the worker,
// the use of that run in `code-map verify`, and the refused runs. The fake home folder is the HOME of each command.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { authorize, entries, project, sandboxed } from './worker-fixtures.mjs';

const cli = fileURLToPath(new URL('../bin/code-map.mjs', import.meta.url));
const nodeTest = ['node', '--test', '--test-reporter=junit', '--test-reporter-destination=junit.xml'];
const code = (fixture, args, cwd = fixture.root) => spawnSync(process.execPath, [cli, ...args], { cwd, encoding: 'utf8', timeout: 120000, env: { ...process.env, HOME: fixture.home } });
const request = (fixture, reportInputs) => {
  const path = join(fixture.work, `request-${Date.now()}.json`);
  writeFileSync(path, JSON.stringify({ requestType: 'code-map-verification-request', schemaVersion: 1, base: 'base', head: 'HEAD', intent: 'Make sum commutative.', acceptanceCriteria: [],
    allowedPaths: ['src/**', 'test/**'], changeType: 'other', profileId: 'static-baseline-v0', ratingRulesVersion: 'ratings-v0', reportInputs,
    execution: { enabled: false, authorization: null, budgets: { wallClockSeconds: 60, memoryMegabytes: 512, outputMegabytes: 8, concurrency: 1 } } }));
  return path;
};

test('code-map authorize writes a private record and prints its ID, and refuses a missing command or a bad expiry', (t) => {
  const fixture = project(t);
  const written = code(fixture, ['authorize', '--store', fixture.store, '--expires-days', '2', '--wall-clock-seconds', '120', '--command', ...nodeTest]);
  assert.equal(written.status, 0, written.stderr);
  const summary = JSON.parse(written.stdout);
  assert.match(summary.authorizationId, /^AUTH-[0-9a-f]{16}$/);
  assert.deepEqual([summary.command, summary.budgets.wallClockSeconds], [nodeTest, 120]);
  assert.equal(Date.parse(summary.expiresAt) - Date.parse(summary.createdAt), 2 * 24 * 3600 * 1000);
  assert.equal(statSync(summary.file).mode & 0o777, 0o600);
  const record = JSON.parse(readFileSync(summary.file, 'utf8'));
  assert.match(record.repository.digest, /^[0-9a-f]{64}$/);
  assert.ok(!readFileSync(summary.file, 'utf8').includes(fixture.root), 'the record names the repository by a digest');
  for (const [args, pattern] of [[['--command'], /--command needs the command words/], [['--expires-days', '0', '--command', 'node'], /--expires-days must be a whole number from 1 to 90/],
    [['--command', '--test'], /first command word/], [[], /--command/]]) {
    const refused = code(fixture, ['authorize', '--store', fixture.store, ...args]);
    assert.deepEqual([refused.status, refused.stdout], [1, ''], args.join(' '));
    assert.match(refused.stderr, pattern);
  }
});

test('code-map run runs node --test in the worker, and verify binds its JUnit report as an isolated report', sandboxed, async (t) => {
  const fixture = project(t);
  fixture.put('src/sum.mjs', 'export function sum(a, b) { return b + a; }\n');
  fixture.git('commit', '-qam', 'head');
  const id = JSON.parse(code(fixture, ['authorize', '--store', fixture.store, '--command', ...nodeTest]).stdout).authorizationId;
  const ran = code(fixture, ['run', '--store', fixture.store, '--authorization', id, '--head', 'HEAD', '--kind', 'junit', '--artifact', 'junit.xml', '--', ...nodeTest]);
  assert.equal(ran.status, 0, ran.stderr);
  const summary = JSON.parse(ran.stdout);
  assert.match(summary.runId, /^R-\d{8}T\d{6}Z-[0-9a-f]{8}$/);
  assert.deepEqual([summary.exitStatus, summary.stoppedBy, summary.policy, summary.backend], [0, null, 'isolated', 'seatbelt']);
  assert.match(readFileSync(summary.files.artifact, 'utf8'), /<testcase name="adds two numbers"/);
  assert.equal(JSON.parse(readFileSync(summary.files.manifest, 'utf8')).environment.policy, 'isolated');

  // A manifest that the project's own run wrote can claim any policy. It stays self-attested.
  fixture.put('reports/junit.xml', readFileSync(summary.files.artifact, 'utf8'));
  const manifest = code(fixture, ['manifest', '--artifact', 'reports/junit.xml', '--kind', 'junit', '--exit-status', '0', '--', 'node', '--test']);
  assert.equal(manifest.status, 0, manifest.stderr);
  const claimed = JSON.parse(manifest.stdout);
  fixture.put('reports/junit.manifest.json', JSON.stringify({ ...claimed, environment: { ...claimed.environment, policy: 'isolated' } }));
  const verified = code(fixture, ['verify', '--store', fixture.store, '--out-dir', join(fixture.work, 'out'), '--request',
    request(fixture, [{ run: summary.runId }, { artifact: 'reports/junit.xml', manifest: 'reports/junit.manifest.json' }])]);
  assert.notEqual(verified.status, 4, verified.stderr);
  const results = JSON.parse(readFileSync(JSON.parse(verified.stdout).files.results, 'utf8'));
  assert.deepEqual(results.executions.map((item) => [item.run ?? null, item.artifact, item.binding, item.eligible, item.attestation, item.cases]),
    [[summary.runId, 'junit.xml', 'BOUND', true, 'isolated', 2], [null, 'reports/junit.xml', 'BOUND', true, 'self-attested', 2]]);
  assert.match(readFileSync(JSON.parse(verified.stdout).files.report, 'utf8'), /Yes, isolated/);
});

test('code-map run refuses an unknown or expired authorization, other command words and another repository, and runs nothing', (t) => {
  const fixture = project(t), other = project(t), command = ['node', '-e', '0'];
  const expired = authorize(fixture, command, { now: new Date(Date.now() - 3 * 24 * 3600 * 1000), days: 1 });
  const foreign = JSON.parse(code(other, ['authorize', '--store', fixture.store, '--command', ...command]).stdout).authorizationId;
  const valid = authorize(fixture, command);
  for (const [id, words, pattern] of [['AUTH-0000000000000000', command, /AUTH-0000000000000000 is not in the store/], [expired, command, /expired at/],
    [valid, ['node', '-e', '1'], /is for other command words/], [foreign, command, /is for another repository/], ['nonsense', command, /is not an authorization ID/]]) {
    const refused = code(fixture, ['run', '--store', fixture.store, '--authorization', id, '--', ...words]);
    assert.deepEqual([refused.status, refused.stdout], [1, ''], `${id} ${words.join(' ')}`);
    assert.match(refused.stderr, pattern);
  }
  const extra = code(fixture, ['run', '--store', fixture.store, '--authorization', valid, 'extra', '--', ...command]);
  assert.match(extra.stderr, /run takes no other words before "--"/);
  assert.match(code(fixture, ['run', '--store', fixture.store, '--authorization', valid, '--head', 'HEAD', '--worktree', '--', ...command]).stderr, /either --head or --worktree/);
  assert.match(code(fixture, ['run', '--store', fixture.store, '--authorization', valid, '--kind', 'junit', '--', ...command]).stderr, /--kind and --artifact/);
  assert.deepEqual([entries(fixture.store, 'runs'), entries(fixture.store, 'workspaces')], [[], []]);
  assert.equal(existsSync(join(fixture.root, 'junit.xml')), false);
});

test('code-map run stops the run when it gets SIGINT, and no process of the run stays', sandboxed, async (t) => {
  const fixture = project(t), marker = `marker-${process.pid}-${Date.now()}`, command = ['node', '-e', 'setInterval(() => {}, 1000)', marker];
  const child = spawn(process.execPath, [cli, 'run', '--store', fixture.store, '--authorization', authorize(fixture, command), '--', ...command],
    { cwd: fixture.root, env: { ...process.env, HOME: fixture.home } });
  let stdout = '';
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  const ended = new Promise((resolve) => child.on('close', resolve)), pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  for (let waited = 0; !entries(fixture.store, 'runs').some((name) => name.startsWith('.staging-')) && waited < 20000; waited += 50) await pause(50);
  await pause(300);
  child.kill('SIGINT');
  assert.equal(await ended, 1);
  assert.deepEqual([JSON.parse(stdout).stoppedBy, JSON.parse(stdout).signal], ['interrupted', 'SIGTERM']);
  assert.ok(!execFileSync('/bin/ps', ['-A', '-o', 'command=']).toString().includes(marker), 'the command of the run is not running');
  assert.deepEqual([entries(fixture.store, 'workspaces'), entries(fixture.store, 'slots')], [[], []]);
});
