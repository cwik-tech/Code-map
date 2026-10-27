// Acceptance tests of `code-map verify` through the CLI: Git fixtures, a temporary store and a temporary output folder.
// Each fixture and each request is in a new temporary folder. Code-map must not change the repository or its .git folder.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonical } from '../lib/inputs.mjs';
import { isInside } from '../lib/inspect.mjs';
import { loadConfig } from '../lib/project.mjs';
import { loadReports } from '../lib/verify.mjs';

const cli = fileURLToPath(new URL('../bin/code-map.mjs', import.meta.url));
const sha256 = (text) => createHash('sha256').update(text).digest('hex');
const posix = { skip: process.platform === 'win32' && 'needs POSIX modes and symlinks' };
const valid = { requestType: 'code-map-verification-request', schemaVersion: 1, base: 'base', head: 'HEAD', intent: 'Change the engine.', acceptanceCriteria: [],
  allowedPaths: ['src/**', 'test/**'], changeType: 'other', profileId: 'static-baseline-v0', ratingRulesVersion: 'ratings-v0', reportInputs: [],
  execution: { enabled: false, authorization: null, budgets: { wallClockSeconds: 60, memoryMegabytes: 512, outputMegabytes: 8, concurrency: 1 } } };

/** A committed TypeScript project with one architecture rule (core -> ui) and one test. The tag "base" names its commit. */
function project(t) {
  const root = mkdtempSync(join(tmpdir(), 'code-map-verify-')), work = mkdtempSync(join(tmpdir(), 'code-map-verify-work-'));
  t.after(() => { rmSync(root, { recursive: true, force: true }); rmSync(work, { recursive: true, force: true }); });
  const put = (path, text) => { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), text); };
  const git = (...args) => execFileSync('git', ['-C', root, '-c', 'user.name=test', '-c', 'user.email=test@example.com', ...args], { encoding: 'utf8' }).trim();
  put('.gitignore', 'reports/\n');
  put('.code-map.json', JSON.stringify({ rules: ['core -> ui'] }));
  put('src/core/engine.ts', 'export function engine() { return 1; }\n');
  put('src/ui/view.ts', "export function view() { return 'v'; }\n");
  put('test/engine.test.ts', "import { test, expect } from 'vitest';\nimport { engine } from '../src/core/engine';\ntest('engine returns one', () => { expect(engine()).toBe(1); });\n");
  git('init', '-q', '-b', 'main'); git('add', '.'); git('commit', '-qm', 'base'); git('tag', 'base');
  const store = join(work, 'store'), out = join(work, 'out');
  let count = 0;
  /** A request file outside the repository: JSON text as it is, or the valid request with these fields. */
  const request = (fields = {}) => {
    const path = join(work, `request-${count++}.json`);
    writeFileSync(path, typeof fields === 'string' ? fields : JSON.stringify({ ...valid, ...fields }));
    return path;
  };
  const verify = (path, args = ['--out-dir', out]) => spawnSync(process.execPath, [cli, 'verify', '--request', path, '--store', store, ...args], { cwd: root, encoding: 'utf8', timeout: 60000 });
  const commit = (message) => { git('add', '.'); git('commit', '-qm', message); return git('rev-parse', 'HEAD'); };
  return { root, work, out, put, git, request, verify, commit };
}

/** A JUnit report of the engine test and its run manifest in the ignored reports/ folder. Returns the pair for reportInputs. */
function report({ root, put }, name, { sha, failed, manifest = {} }) {
  const xml = `<?xml version="1.0"?>\n<testsuites><testsuite name="test/engine.test.ts" tests="1" failures="${failed ? 1 : 0}">`
    + `<testcase classname="test/engine.test.ts" file="test/engine.test.ts" name="engine returns one">${failed ? '<failure message="expected 2 to be 1"/>' : ''}</testcase>`
    + '</testsuite></testsuites>\n';
  const artifact = `reports/${name}.xml`, path = `reports/${name}.manifest.json`;
  put(artifact, xml);
  put(path, JSON.stringify({ manifestType: 'code-map-run-manifest', schemaVersion: 1, source: { sha, worktreeDigest: null }, command: ['npx', 'vitest', 'run', '--reporter=junit'],
    workingDirectory: '.', tools: [{ name: 'vitest', version: '3.2.4' }], config: sha256(canonical(loadConfig(root))), lockfile: null,
    environment: { policy: 'local', node: process.versions.node, platform: process.platform }, startedAt: '2026-10-22T18:00:00.000Z', finishedAt: '2026-10-22T18:00:05.000Z',
    exitStatus: failed ? 1 : 0, artifacts: [{ path: artifact, digest: sha256(xml), kind: 'junit' }], discovery: { scope: 'vitest run', filters: [] }, ...manifest }));
  return { artifact, manifest: path };
}

/** The time, size and content of every entry under the folder, the .git folder included. */
function snapshot(root) {
  const state = {};
  const walk = (folder) => {
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      const path = join(folder, entry.name), key = relative(root, path), info = lstatSync(path);
      if (entry.isDirectory()) { state[key] = 'folder'; walk(path); }
      else state[key] = entry.isSymbolicLink() ? `link ${readlinkSync(path)}` : `${info.mtimeMs} ${info.size} ${sha256(readFileSync(path))}`;
    }
  };
  walk(root);
  return state;
}

/** The summary on stdout, with the exit code that the test expects. */
function summaryOf(output, code) {
  assert.equal(output.status, code, output.stderr);
  const summary = JSON.parse(output.stdout);
  assert.equal(summary.reportType, 'code-map-verification-summary');
  assert.equal(summary.exitCode, code);
  return summary;
}
const resultsOf = (summary) => JSON.parse(readFileSync(summary.files.results, 'utf8'));
const mode = (path) => statSync(path).mode & 0o777;

test('an invalid request, an incomplete execution request or an unknown rule set gives exit 4, empty stdout and no run folder', posix, (t) => {
  const { root, work, out, put, request, verify } = project(t);
  writeFileSync(join(work, 'outside.xml'), '<testsuites/>\n');
  mkdirSync(join(root, 'reports'), { recursive: true });
  symlinkSync(join(work, 'outside.xml'), join(root, 'reports', 'outside.xml'));
  put('reports/outside.manifest.json', '{}');
  symlinkSync(join(work, 'outside.xml'), join(root, 'reports', '\u001b[31mout.xml'));
  const budgets = valid.execution.budgets;
  const cases = [
    [request('{ "requestType": '), /not valid JSON/],
    // Text from the request reaches stderr with each control character as a visible escape, so it cannot drive the terminal.
    [request({ '\u001b]0;PWNED\u0007\u001b[31mRED': 1 }), /\\u001b\]0;PWNED\\u0007\\u001b\[31mRED: Unknown field/],
    [request('{"a": \u001b[31mRED}'), /not valid JSON.*\\u001b\[31mRED/],
    [request({ reportInputs: [{ artifact: 'reports/\u001b[31mout.xml', manifest: 'reports/outside.manifest.json' }] }), /reports\/\\u001b\[31mout\.xml in reportInputs is outside/],
    [request({ schemaVersion: 2, changeType: 'rewrite' }), /schemaVersion[\s\S]*changeType/],
    [request({ execution: { enabled: true, authorization: 'ticket-1', budgets } }), /execution.authorization[\s\S]*execution.commands/],
    [request({ profileId: 'other-v1' }), /rule set "other-v1"/],
    [request({ ratingRulesVersion: 'ratings-v9' }), /rating rules "ratings-v9"/],
    [request({ base: 'no-such-tag' }), /base "no-such-tag" is not a commit/],
    [request({ head: 'no-such-tag' }), /head "no-such-tag" is not a commit/],
    [request({ reportInputs: [{ artifact: 'reports/outside.xml', manifest: 'reports/outside.manifest.json' }] }), /outside the repository/],
    [join(work, 'missing.json'), /Cannot read the request file/],
  ];
  const before = snapshot(root);
  for (const [path, message] of cases) {
    const output = verify(path);
    assert.equal(output.status, 4, `${path}: ${output.stderr}`);
    assert.equal(output.stdout, '');
    assert.match(output.stderr, message);
    assert.doesNotMatch(output.stderr, /[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/, path);
  }
  const inside = verify(request(), ['--out-dir', join(root, 'reports', 'verify')]);
  assert.deepEqual([inside.status, inside.stdout], [4, '']);
  assert.match(inside.stderr, /inside the repository/);
  const extra = verify(request(), ['--out-dir', out, '--ref', 'HEAD']);
  assert.deepEqual([extra.status, extra.stdout], [4, '']);
  assert.match(extra.stderr, /--ref/);
  assert.equal(existsSync(out), false, 'no run folder and no latest.json');
  assert.deepEqual(snapshot(root), before);
});

test('without --out-dir, each repository has its own output folder in the store, so latest.json names a run of that repository', (t) => {
  const one = project(t), two = project(t), store = join(one.work, 'shared');
  const run = ({ root, request }) => summaryOf(spawnSync(process.execPath, [cli, 'verify', '--request', request(), '--store', store], { cwd: root, encoding: 'utf8', timeout: 60000 }), 3);
  const first = run(one), second = run(two), again = run(one), folders = [first, second, again].map((summary) => dirname(summary.files.manifest));
  assert.deepEqual([folders[0] === folders[2], folders[0] === folders[1]], [true, false]);
  for (const folder of folders) assert.match(relative(join(store, 'verifications'), folder), /^[0-9a-f]{16}$/);
  assert.deepEqual([first, second].map((summary) => JSON.parse(readFileSync(summary.files.manifest, 'utf8')).runId), [again.runId, second.runId]);
});

test('--out-dir and --store are refused inside the Git folders of a linked worktree and through a path alias of the repository', posix, (t) => {
  const { root, work, git, request } = project(t), linked = join(work, 'linked'), store = join(work, 'store'), out = join(work, 'out');
  git('worktree', 'add', '-q', '-b', 'linked', linked); const common = join(root, '.git'), own = join(common, 'worktrees', 'linked');
  const cases = [[linked, ['--store', store, '--out-dir', join(common, 'cm-out')]], [linked, ['--store', join(own, 'cm-store'), '--out-dir', out]], [linked, ['--store', join(common, 'cm-store'), '--out-dir', out]]];
  // macOS also reaches a folder through the firmlink /System/Volumes/Data, and realpath keeps that prefix.
  const alias = join('/System/Volumes/Data', realpathSync(root)), same = (a, b) => { try { const [x, y] = [statSync(a), statSync(b)]; return x.dev === y.dev && x.ino === y.ino; } catch { return false; } };
  if (same(alias, root)) cases.push([root, ['--store', store, '--out-dir', join(alias, 'out')]], [root, ['--store', join(alias, 'st'), '--out-dir', out]]);
  for (const [cwd, args] of cases) {
    const output = spawnSync(process.execPath, [cli, 'verify', '--request', request(), ...args], { cwd, encoding: 'utf8', timeout: 60000 });
    assert.deepEqual([output.status, output.stdout], [4, ''], args.join(' '));
    assert.match(output.stderr, /is inside the (repository|Git folder)/);
  }
  for (const path of [join(common, 'cm-out'), join(own, 'cm-store'), join(common, 'cm-store'), join(root, 'out'), join(root, 'st'), out]) assert.equal(existsSync(path), false, path);
  assert.deepEqual(['darwin', 'linux'].map((platform) => isInside('/private/tmp/r', '/System/Volumes/Data/private/tmp/r/out', platform)), [true, false]);
});

test('the reports of one request have a total limit on count, bytes and test cases, and each extra report does not count, with a reason', (t) => {
  const fixture = project(t), { root, git } = fixture, sha = git('rev-parse', 'HEAD');
  const inputs = ['one', 'two', 'three'].map((name) => report(fixture, name, { sha, failed: false })), size = statSync(join(root, inputs[0].artifact)).size;
  const side = { inputs: { sha, worktree: null, config: sha256(canonical(loadConfig(root))), lockfile: null }, sha, analysis: { tests: { testFiles: [] } } };
  const load = (limits) => loadReports(root, inputs, { head: side, base: side }, limits).executions.map((item) => [item.eligible, ...item.reasons.map((reason) => `${reason.key}: ${reason.message}`)].join(' '));
  const [first, more, many] = load({ reports: 2, bytes: size * 9, cases: 1 }), [kept, ...over] = load({ reports: 9, bytes: size, cases: 9 });
  assert.deepEqual([first, kept, over.length], ['true', 'true', 2]);
  assert.match(more, /^false limit: .*more than 1 test cases\. .* so this report does not count\.$/);
  assert.match(many, /^false limit: The request lists more than 2 reports\. Code-map reads only the first 2, so this report does not count\.$/);
  for (const text of over) assert.match(text, /^false limit: .*more than [\d,]+ bytes\. .* so this report does not count\.$/);
});

test('the default output folders must be private, so another user cannot plant a verifications folder in a shared store', posix, (t) => {
  const { root, work, request } = project(t), shared = join(work, 'shared');
  mkdirSync(join(shared, 'verifications'), { recursive: true });
  chmodSync(shared, 0o1777); chmodSync(join(shared, 'verifications'), 0o777);
  const output = spawnSync(process.execPath, [cli, 'verify', '--request', request(), '--store', shared], { cwd: root, encoding: 'utf8', timeout: 60000 });
  assert.equal(output.status, 4, output.stderr);
  assert.equal(output.stdout, '');
  assert.match(output.stderr, /not a private folder that you own/);
  assert.deepEqual(readdirSync(join(shared, 'verifications')), [], 'nothing is written into the planted folder');
  chmodSync(join(shared, 'verifications'), 0o700); chmodSync(shared, 0o700);
});
