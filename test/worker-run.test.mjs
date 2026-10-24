// Runs in the restricted worker through lib/worker/run.mjs: the policy inside the sandbox, the exit status, the artifact and
// the user's repository after the run. Each test makes its own Git project, store and fake home folder in a temporary folder.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { existsSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { type, release, arch } from 'node:os';
import ts from 'typescript';
import { validateManifest } from '../lib/adapters/run-manifest.mjs';
import { canonical } from '../lib/inputs.mjs';
import { loadConfig } from '../lib/project.mjs';
import { loadReports } from '../lib/verify-reports.mjs';
import { runCommand } from '../lib/worker/run.mjs';
import { authorize, entries, output, project, run, sandboxed, sha256, snapshot } from './worker-fixtures.mjs';

const node = process.execPath;

test('a TCP connection to a server on 127.0.0.1 is refused inside the worker', sandboxed, async (t) => {
  const fixture = project(t), server = createServer((socket) => socket.end('hello')), connected = [];
  server.on('connection', () => connected.push(1));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const result = await run(fixture, [node, 'probe.mjs', 'net', String(server.address().port)]);
  assert.equal(result.record.exitStatus, 0, output(result));
  assert.equal(output(result).trim(), 'EPERM');
  assert.deepEqual(connected, [], 'the server saw no connection');
  assert.equal(result.record.policy, 'isolated');
  assert.equal(result.record.network, 'denied');
});

test('a write outside the workspace is refused: into the home folder, into the repository and into the store', sandboxed, async (t) => {
  const fixture = project(t), targets = [join(fixture.home, 'planted'), join(fixture.root, 'planted'), join(fixture.store, 'planted')];
  for (const target of targets) {
    const result = await run(fixture, [node, 'probe.mjs', 'write', target]);
    assert.equal(output(result).trim(), 'EPERM', target);
    assert.equal(existsSync(target), false, target);
  }
  const inside = await run(fixture, [node, 'probe.mjs', 'write', 'reports/inside.txt']);
  assert.equal(output(inside).trim(), 'ENOENT', 'the reports folder does not exist yet, so the write fails only because of the folder');
  const tmp = await run(fixture, [node, '-e', 'require("fs").writeFileSync(require("path").join(process.env.TMPDIR, "t"), "x"); console.log("written")']);
  assert.equal(output(tmp).trim(), 'written', 'the private temporary folder of the workspace is writable');
});

test('a read of a protected folder is refused: a credential file in the home folder and the repository itself', sandboxed, async (t) => {
  const fixture = project(t);
  for (const target of [join(fixture.home, '.ssh', 'id_rsa'), join(fixture.root, 'probe.mjs'), join(fixture.root, '.git', 'config')]) {
    const result = await run(fixture, [node, 'probe.mjs', 'read', target]);
    assert.equal(output(result).trim(), 'EPERM', target);
  }
  const copy = await run(fixture, [node, 'probe.mjs', 'read', 'src/sum.mjs']);
  assert.equal(output(copy).trim(), 'allowed', 'the run reads its own copy of the snapshot');
});

test('an environment variable of the parent is not visible inside the worker, and HOME and TMPDIR are in the workspace', sandboxed, async (t) => {
  const fixture = project(t), result = await run(fixture, [node, 'probe.mjs', 'env']), env = JSON.parse(output(result));
  assert.equal(env.CODE_MAP_TEST_TOKEN, undefined);
  assert.deepEqual(Object.keys(env).filter((key) => !['PATH', 'HOME', 'TMPDIR', 'CI', 'LANG', 'LC_ALL', 'LC_CTYPE'].includes(key)), []);
  assert.equal(env.CI, '1');
  const workspace = realpathSync(join(fixture.store, 'workspaces')).toLowerCase();
  for (const key of ['HOME', 'TMPDIR']) assert.ok(env[key].toLowerCase().startsWith(workspace), `${key} ${env[key]}`);
  assert.equal(env.PATH.split(':')[0], realpathSync(join(node, '..')));
});

test('the record keeps the exit status of the command, and the workspace is removed after the run', sandboxed, async (t) => {
  const fixture = project(t), result = await run(fixture, [node, '-e', 'process.exit(3)']);
  assert.deepEqual([result.record.exitStatus, result.record.signal, result.record.stoppedBy], [3, null, null]);
  assert.equal(result.exitCode, 0, 'the run itself ended normally');
  assert.equal(result.record.backend.name, 'seatbelt');
  assert.equal(result.record.workspace.removed, true);
  assert.deepEqual(entries(fixture.store, 'workspaces'), []);
  assert.deepEqual(entries(fixture.store, 'slots'), []);
  assert.deepEqual(JSON.parse(readFileSync(result.paths.record, 'utf8')), result.record);
});

test('the artifact goes into the run folder with its digest, and its manifest binds it to the commit with the policy "isolated"', sandboxed, async (t) => {
  const fixture = project(t), xml = '<?xml version="1.0"?>\n<testsuites><testcase name="one" classname="test"/></testsuites>\n';
  const script = `require("fs").mkdirSync("reports"); require("fs").writeFileSync("reports/junit.xml", ${JSON.stringify(xml)})`;
  const result = await run(fixture, [node, '-e', script], { kind: 'junit', artifact: 'reports/junit.xml' });
  assert.equal(result.exitCode, 0, JSON.stringify(result.record.problems));
  assert.equal(readFileSync(result.paths.artifact, 'utf8'), xml);
  assert.deepEqual(result.record.artifact, { path: 'reports/junit.xml', kind: 'junit', digest: sha256(xml), file: 'report.xml' });
  const manifest = JSON.parse(readFileSync(result.paths.manifest, 'utf8'));
  assert.equal(validateManifest(manifest).ok, true);
  assert.deepEqual(manifest.artifacts, [{ path: 'reports/junit.xml', digest: sha256(xml), kind: 'junit' }]);
  assert.deepEqual(manifest.source, { sha: fixture.git('rev-parse', 'HEAD'), worktreeDigest: null });
  assert.deepEqual(manifest.environment, { policy: 'isolated', node: process.versions.node, platform: process.platform, backend: 'seatbelt', os: type(), osVersion: release(), architecture: arch(), typescript: ts.version });
  assert.equal(manifest.exitStatus, 0);
});

test('an artifact path that leaves the workspace is refused: ".." before the run, and a symlink after it', sandboxed, async (t) => {
  const fixture = project(t);
  await assert.rejects(run(fixture, [node, '-e', '0'], { kind: 'junit', artifact: '../outside.xml' }), /--artifact must name .* relative/);
  const script = `require("fs").mkdirSync("reports"); require("fs").symlinkSync(${JSON.stringify(join(fixture.home, '.ssh', 'id_rsa'))}, "reports/junit.xml")`;
  const result = await run(fixture, [node, '-e', script], { kind: 'junit', artifact: 'reports/junit.xml' });
  assert.equal(result.exitCode, 1);
  assert.equal(result.record.artifact, null);
  assert.match(result.record.problems.join(' '), /reports\/junit\.xml .*symlink/);
  assert.equal(result.paths.artifact, null);
  assert.equal(result.paths.manifest, null, 'no manifest without an artifact');
});

test('a stored run counts in verify only in its own repository, with its digest, and its test file names map from the workspace to the repository', sandboxed, async (t) => {
  const fixture = project(t), other = project(t), sha = fixture.git('rev-parse', 'HEAD');
  const result = await run(fixture, [node, '--test', '--test-reporter=junit', '--test-reporter-destination=junit.xml'], { kind: 'junit', artifact: 'junit.xml' });
  const side = { inputs: { sha, worktree: null, config: sha256(canonical(loadConfig(fixture.root))), lockfile: null }, sha, analysis: { tests: { testFiles: [{ path: 'test/sum.test.mjs' }] } } };
  const load = (repository, inputs) => loadReports(repository, inputs, { head: side, base: side }, undefined, fixture.store);
  const id = result.record.runId, loaded = load(fixture.root, [{ run: id }, { run: id }, { run: 'R-20261022T000000Z-00000000' }]);
  assert.deepEqual(loaded.executions.map((item) => [item.eligible, item.attestation, item.reasons.map((reason) => reason.key).join()]), [[true, 'isolated', ''], [false, null, 'duplicate'], [false, null, 'run']]);
  assert.deepEqual(loaded.reports.head[0].cases.map((item) => item.file), ['test/sum.test.mjs', 'test/sum.test.mjs']);
  assert.match(load(other.root, [{ run: id }]).executions[0].reasons[0].message, /is of another repository/);
  writeFileSync(result.paths.artifact, readFileSync(result.paths.artifact, 'utf8').replace('adds two numbers', 'adds two words'));
  assert.match(load(fixture.root, [{ run: id }]).executions[0].reasons[0].message, /does not have the digest in its record/);
});

test('the user\'s repository is unchanged after runs of the head commit and of the working tree: git status and every file time', sandboxed, async (t) => {
  const fixture = project(t);
  fixture.put('src/sum.mjs', 'export function sum(a, b) { return b + a; }\n');
  fixture.put('notes.txt', 'untracked\n');
  // The status comes first: the git status of the test refreshes the index, and Code-map must not.
  const status = fixture.git('status', '--porcelain'), before = snapshot(fixture.root);
  const script = 'require("fs").writeFileSync("src/sum.mjs", "changed"); require("fs").rmSync("test", { recursive: true }); console.log(require("fs").readFileSync("notes.txt", "utf8").trim())';
  const tree = await run(fixture, [node, '-e', script], { head: undefined, worktree: true });
  assert.equal(output(tree).trim(), 'untracked', 'the working-tree copy has the untracked file');
  assert.match(tree.record.source.worktreeDigest, /^[0-9a-f]{64}$/);
  const commit = await run(fixture, [node, '-e', 'console.log(require("fs").existsSync("notes.txt"))']);
  assert.equal(output(commit).trim(), 'false', 'the commit copy has only the committed files');
  assert.deepEqual(snapshot(fixture.root), before);
  assert.equal(fixture.git('status', '--porcelain'), status);
});

test('without a backend, a run is refused before anything starts: no workspace, no slot and no run folder', async (t) => {
  const fixture = project(t), marker = join(fixture.work, 'ran');
  const command = [node, '-e', `require("fs").writeFileSync(${JSON.stringify(marker)}, "x")`];
  const id = authorize(fixture, command);
  await assert.rejects(runCommand(fixture.root, loadConfig(fixture.root), { authorization: id, command, head: 'HEAD', store: fixture.store }, { backend: null, platform: 'win32' }),
    /refuses to run .* never runs it without (a backend|isolation)/);
  assert.equal(existsSync(marker), false, 'the command never ran');
  for (const name of ['workspaces', 'slots', 'runs']) assert.deepEqual(entries(fixture.store, name), [], name);
});
