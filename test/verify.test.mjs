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

test('acceptance: a new architecture-rule break gives BLOCKED and exit 2, with private report files and no change in the repository', posix, (t) => {
  const fixture = project(t), { root, out, put, git, request, verify, commit } = fixture;
  put('src/core/engine.ts', "import { view } from '../ui/view';\nexport function engine() { return view().length; }\n");
  const head = commit('head'), before = snapshot(root);
  const summary = summaryOf(verify(request({ intent: 'Let the engine use the view.' })), 2);
  assert.equal(summary.readiness, 'BLOCKED');
  assert.ok(summary.blocking.includes('structure.architecture-rules'), JSON.stringify(summary.blocking));
  assert.ok(summary.failed.includes('structure.architecture-rules'));
  assert.deepEqual(Object.keys(summary.ratings), ['structuralIntegrity', 'verificationCoverage', 'behavioralConfidence', 'changeCompleteness']);
  assert.deepEqual(summary.ratings.structuralIntegrity, { state: 'RATED', value: 1, label: 'Failing' });
  assert.equal(summary.total, undefined, 'the summary has no total or average');

  const results = resultsOf(summary);
  assert.equal(results.reportType, 'code-map-verification');
  assert.equal(results.runId, summary.runId);
  assert.deepEqual([results.readiness.state, results.readiness.exitCode], ['BLOCKED', 2]);
  assert.deepEqual([results.base.ref, results.base.sha, results.head.ref, results.head.sha], ['base', git('rev-parse', 'base'), 'HEAD', head]);
  assert.match(results.base.analysisId, /^A-[0-9a-f]{16}$/);
  assert.equal(results.comparison.state, 'COMPARABLE');
  assert.deepEqual(results.change.paths, ['src/core/engine.ts']);
  assert.equal(results.request.digest, sha256(readFileSync(join(fixture.work, 'request-0.json'))));
  assert.ok(results.limits.length > 0 && results.gaps.length > 0);
  assert.deepEqual(results.llmHypotheses, []);
  const markdown = readFileSync(summary.files.report, 'utf8');
  assert.match(markdown, /\*\*The readiness of this change is BLOCKED\.\*\*/);

  const latest = JSON.parse(readFileSync(join(out, 'latest.json'), 'utf8'));
  assert.deepEqual([latest.runId, latest.readiness, latest.exitCode], [summary.runId, 'BLOCKED', 2]);
  assert.equal(latest.results.sha256, sha256(readFileSync(summary.files.results)));
  assert.equal(latest.report.sha256, sha256(readFileSync(summary.files.report)));
  assert.equal(summary.files.manifest, join(out, 'latest.json'));
  for (const folder of [join(out, 'runs'), dirname(summary.files.results)]) assert.equal(mode(folder), 0o700, folder);
  for (const file of [summary.files.results, summary.files.report, join(out, 'latest.json')]) assert.equal(mode(file), 0o600, file);
  assert.deepEqual(snapshot(root), before, 'verify changed nothing in the repository or its .git folder');

  // A request that fails after an earlier run leaves that run and latest.json as they were.
  const runs = readdirSync(join(out, 'runs')), manifest = readFileSync(join(out, 'latest.json'));
  const invalid = verify(request({ schemaVersion: 2 }));
  assert.deepEqual([invalid.status, invalid.stdout], [4, '']);
  assert.deepEqual(readdirSync(join(out, 'runs')), runs);
  assert.deepEqual(readFileSync(join(out, 'latest.json')), manifest);
});

test('acceptance: a clean refactor of the working tree gives INSUFFICIENT_EVIDENCE and exit 3, and two categories stay Unassessed', (t) => {
  const { root, put, request, verify } = project(t);
  put('src/core/engine.ts', 'const one = () => 1;\nexport function engine() { return one(); }\n');
  const before = snapshot(root);
  const summary = summaryOf(verify(request({ head: 'worktree', changeType: 'refactor', intent: 'Move the value of the engine into a helper.' })), 3);
  assert.equal(summary.readiness, 'INSUFFICIENT_EVIDENCE');
  assert.deepEqual(summary.blocking, []);
  assert.deepEqual(summary.ratings.behavioralConfidence, { state: 'UNASSESSED', value: null, label: 'Unassessed' });
  assert.deepEqual(summary.ratings.verificationCoverage, { state: 'UNASSESSED', value: null, label: 'Unassessed' });

  const results = resultsOf(summary), byId = Object.fromEntries(results.obligations.map((item) => [item.id, item]));
  assert.equal(results.head.ref, 'worktree');
  assert.match(results.head.worktreeDigest, /^[0-9a-f]{64}$/);
  assert.deepEqual(results.change.paths, ['src/core/engine.ts']);
  assert.equal(results.comparison.state, 'COMPARABLE');
  assert.equal(byId['refactor.behavior-preserved'].result, 'UNKNOWN');
  assert.deepEqual(['structure.architecture-rules', 'completeness.no-focused-test', 'scope.allowed-paths'].map((id) => byId[id].result), ['PASS', 'PASS', 'PASS']);
  assert.equal(results.ratings.behavioralConfidence.evidenceCompleteness.required.total, 1);
  assert.deepEqual(snapshot(root), before, 'verify changed nothing in the repository or its .git folder');
});

test('a bound JUnit report with a new failed case gives BLOCKED, and unbound and stale reports are listed as ineligible', (t) => {
  const fixture = project(t), { put, request, verify, commit } = fixture;
  put('src/core/engine.ts', 'export function engine() { return 2; }\n');
  const head = commit('head');
  const inputs = [report(fixture, 'head', { sha: head, failed: true }), report(fixture, 'unbound', { sha: head, failed: false, manifest: { schemaVersion: 7, source: undefined, artifacts: undefined } }),
    report(fixture, 'stale', { sha: head, failed: true, manifest: { config: 'f'.repeat(64) } }),
    report(fixture, 'passed', { sha: head, failed: true, manifest: { exitStatus: 0 } }), report(fixture, 'undiscovered', { sha: head, failed: true, manifest: { discovery: null } }), report(fixture, 'broken', { sha: head, failed: true })];
  put('reports/broken.manifest.json', '{ not JSON');
  const summary = summaryOf(verify(request({ reportInputs: inputs })), 2);
  assert.ok(summary.blocking.includes('behavior.no-new-failures'), JSON.stringify(summary.blocking));
  assert.ok(!summary.blocking.includes('structure.architecture-rules'));

  const results = resultsOf(summary), executions = Object.fromEntries(results.executions.map((item) => [item.artifact, item]));
  assert.deepEqual(results.executions.map((item) => item.artifact), ['reports/head.xml', 'reports/unbound.xml', 'reports/stale.xml', 'reports/passed.xml', 'reports/undiscovered.xml', 'reports/broken.xml']);
  for (const [artifact, key] of [['reports/passed.xml', 'exit-status'], ['reports/undiscovered.xml', 'discovery']]) {
    const item = executions[artifact];
    assert.deepEqual([item.binding, item.eligible, item.reasons.map((reason) => reason.key)], ['BOUND', false, [key]], artifact);
  }
  const bound = executions['reports/head.xml'];
  assert.deepEqual([bound.side, bound.binding, bound.eligible, bound.kind, bound.cases, bound.failed], ['head', 'BOUND', true, 'junit', 1, 1]);
  for (const artifact of ['reports/unbound.xml', 'reports/broken.xml']) assert.deepEqual([executions[artifact].binding, executions[artifact].eligible], ['UNBOUND', false], artifact);
  assert.match(executions['reports/broken.xml'].reasons[0].message, /not valid JSON/);
  const stale = executions['reports/stale.xml'];
  assert.deepEqual([stale.binding, stale.eligible], ['STALE', false]);
  assert.deepEqual(results.executions.map((item) => item.attestation), ['self-attested', null, null, 'self-attested', 'self-attested', null], 'accepted decision 5: each bound report is self-attested');
  assert.ok(results.limits.some((text) => /self-attested/.test(text)), JSON.stringify(results.limits));
  assert.ok(stale.reasons.some((reason) => reason.key === 'config'), JSON.stringify(stale.reasons));
  const failure = results.obligations.find((item) => item.id === 'behavior.no-new-failures');
  assert.deepEqual([failure.result, failure.blocking], ['FAIL', true]);
  assert.match(readFileSync(summary.files.report, 'utf8'), /reports\/unbound\.xml/);
});

test('a failed case that a base report of the same run also has does not block, and the check of earlier failures shows it', (t) => {
  const fixture = project(t), { git, put, request, verify, commit } = fixture;
  const base = report(fixture, 'base', { sha: git('rev-parse', 'base'), failed: true });
  put('src/core/engine.ts', '// The engine.\nexport function engine() { return 1; }\n');
  const head = report(fixture, 'head', { sha: commit('head'), failed: true });
  const summary = summaryOf(verify(request({ reportInputs: [head, base] })), 3);
  assert.equal(summary.readiness, 'INSUFFICIENT_EVIDENCE');
  const results = resultsOf(summary), byId = Object.fromEntries(results.obligations.map((item) => [item.id, item]));
  assert.deepEqual(results.executions.map((item) => [item.artifact, item.side, item.eligible]), [['reports/head.xml', 'head', true], ['reports/base.xml', 'base', true]]);
  assert.equal(byId['behavior.no-new-failures'].result, 'PASS');
  assert.equal(byId['behavior.earlier-failures'].result, 'FAIL');
  assert.equal(byId['coverage.head-run'].result, 'PASS');
});

test('an invalid request, a request to run project code or an unknown rule set gives exit 4, empty stdout and no run folder', posix, (t) => {
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
    [request({ execution: { enabled: true, authorization: 'ticket-1', budgets } }), /runs no project code/],
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

test('a head commit with other settings in the working folder fails the settings check, and the architecture-rule check cannot pass', (t) => {
  const { put, request, verify, commit } = project(t), byId = (summary) => Object.fromEntries(resultsOf(summary).obligations.map((item) => [item.id, item]));
  put('src/core/engine.ts', "import { view } from '../ui/view';\nexport function engine() { return view().length; }\n");
  commit('head'); put('.code-map.json', JSON.stringify({ rules: [] }));
  const summary = summaryOf(verify(request()), 3), checks = byId(summary), settings = checks['completeness.settings-unchanged'], rules = checks['structure.architecture-rules'];
  assert.deepEqual([settings.result, settings.required, settings.blocking, settings.eligible, settings.evidenceIds, summary.failed.includes(settings.id)], ['FAIL', true, false, true, ['path:.code-map.json'], true]);
  assert.match(settings.rationale, /working folder has other settings than the head commit in \.code-map\.json/);
  assert.deepEqual([rules.result, rules.applicability, rules.eligible, rules.applicabilityReason], ['UNKNOWN', 'UNKNOWN', false, undefined]);
  // With the settings of the head commit again, the rule break blocks and the settings check passes.
  put('.code-map.json', JSON.stringify({ rules: ['core -> ui'] }));
  assert.equal(byId(summaryOf(verify(request()), 2))['completeness.settings-unchanged'].result, 'PASS');
  put('docs/code-map/test-labels.json', JSON.stringify({ files: {} }));
  const labeled = byId(summaryOf(verify(request()), 2)), [labelsCheck, rulesCheck] = [labeled['completeness.settings-unchanged'], labeled['structure.architecture-rules']];
  assert.deepEqual([labelsCheck.result, labelsCheck.evidenceIds, rulesCheck.result], ['FAIL', ['path:docs/code-map/test-labels.json'], 'FAIL'], 'a new labels file fails the check, and the rules stay those of the head commit');
});

test('each rating keeps the evidence IDs of its predicates, so the results name the dynamic import that caps the band', (t) => {
  const { put, request, verify } = project(t);
  put('src/core/engine.ts', 'export function engine() { return 1; }\nexport const load = (name: string) => import(name);\n');
  const rating = resultsOf(summaryOf(verify(request({ head: 'worktree' })), 3)).ratings.structuralIntegrity, { met, unmet, unknown } = rating.predicates;
  assert.ok(unmet.includes('si.imports-classified'), JSON.stringify(rating.predicates));
  assert.ok(rating.predicateEvidence['si.imports-classified'].includes('import:src/core/engine.ts:2'), JSON.stringify(rating.predicateEvidence));
  assert.deepEqual(Object.keys(rating.predicateEvidence).sort(), [...new Set([...rating.failures, ...met, ...unmet, ...unknown])].sort());
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
