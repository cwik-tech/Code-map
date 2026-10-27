// Acceptance tests of `code-map verify` through the CLI: Git fixtures, a temporary store and a temporary output folder.
// Each fixture and each request is in a new temporary folder. Code-map must not change the repository or its .git folder.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, realpathSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonical } from '../lib/inputs.mjs';
import { isInside } from '../lib/inspect.mjs';
import { loadConfig } from '../lib/project.mjs';
import { runVerify, loadReports } from '../lib/verify.mjs';

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
    environment: { policy: 'local', node: process.versions.node, platform: process.platform, os: 'fixture-os', osVersion: 'fixture-release', architecture: 'fixture-arch', typescript: '6.0.3' }, startedAt: '2026-10-22T18:00:00.000Z', finishedAt: '2026-10-22T18:00:05.000Z',
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

test('runVerify reports skipped and missing outcomes without changing failure checks or readiness', (t) => {
  const fixture = project(t), { root, put, request, commit, out, work } = fixture;
  const base = report(fixture, 'base', { sha: fixture.git('rev-parse', 'HEAD'), failed: false });
  put('src/core/engine.ts', '// head\nexport function engine() { return 1; }\n');
  const head = report(fixture, 'head', { sha: commit('head'), failed: false });
  const addCases = (input) => {
    const xml = readFileSync(join(root, input.artifact), 'utf8').replace('tests="1"', 'tests="3"').replace('</testsuite>',
      '<testcase file="test/engine.test.ts" name="stable"/><testcase file="test/engine.test.ts" name="absent"/></testsuite>');
    put(input.artifact, xml);
    const manifest = JSON.parse(readFileSync(join(root, input.manifest), 'utf8'));
    manifest.artifacts[0].digest = sha256(xml);
    put(input.manifest, JSON.stringify(manifest));
  };
  addCases(base);
  addCases(head);
  const verify = () => runVerify(root, loadConfig(root), { request: request({ reportInputs: [base, head] }), store: join(work, 'store'), 'out-dir': out });
  const before = verify().results;
  const xml = readFileSync(join(root, head.artifact), 'utf8').replace('</testcase>', '<skipped/></testcase>')
    .replace('<testcase file="test/engine.test.ts" name="absent"/>', '').replace('tests="3"', 'tests="2" skipped="1"');
  put(head.artifact, xml);
  const manifest = JSON.parse(readFileSync(join(root, head.manifest), 'utf8'));
  manifest.artifacts[0].digest = sha256(xml);
  put(head.manifest, JSON.stringify(manifest));
  const verified = verify(), after = verified.results;
  assert.deepEqual(after.tests.outcomes.counts, { 'passed>skipped': 1, 'passed>missing': 1 });
  assert.deepEqual(after.tests.outcomes.entries.map((entry) => entry.name), ['absent', 'engine returns one']);
  assert.deepEqual(after.obligations.map(({ id, result }) => ({ id, result })), before.obligations.map(({ id, result }) => ({ id, result })));
  assert.deepEqual(after.ratings, before.ratings);
  assert.deepEqual(after.readiness, before.readiness);
  assert.equal(after.obligations.find((entry) => entry.id === 'behavior.no-new-failures').result, 'PASS');
  assert.match(readFileSync(verified.paths.markdownPath, 'utf8'), /Case outcome transitions: passed\\>missing 1, passed\\>skipped 1.*Base passes that are now skipped or missing: `test\/engine\.test\.ts > absent` and `test\/engine\.test\.ts > engine returns one`/);
});

/** Replace a report and bind its manifest to the replacement bytes. */
function rewriteReport(fixture, input, text, changes = {}) {
  fixture.put(input.artifact, text);
  const manifest = JSON.parse(readFileSync(join(fixture.root, input.manifest), 'utf8'));
  manifest.artifacts[0].digest = sha256(text);
  fixture.put(input.manifest, JSON.stringify({ ...manifest, ...changes }));
}

for (const profileId of ['static-baseline-v0', 'evidence-v1']) {
  const ratingRulesVersion = profileId === 'evidence-v1' ? 'ratings-v1' : 'ratings-v0';
  const run = (fixture, inputs, fields = {}) => runVerify(fixture.root, loadConfig(fixture.root), {
    request: fixture.request({ profileId, ratingRulesVersion, reportInputs: inputs, ...fields }),
    store: join(fixture.work, 'store'), 'out-dir': fixture.out,
  }).results;
  const resultOf = (results, id = 'behavior.no-new-failures') => results.obligations.find((entry) => entry.id === id).result;

  test(`${profileId}: an extra duplicate failure is new`, (t) => {
    const fixture = project(t), base = report(fixture, 'base', { sha: fixture.git('rev-parse', 'base'), failed: true });
    fixture.put('src/core/engine.ts', '// head\nexport function engine() { return 1; }\n');
    const head = report(fixture, 'head', { sha: fixture.commit('head'), failed: true });
    const xml = readFileSync(join(fixture.root, head.artifact), 'utf8');
    rewriteReport(fixture, head, xml.replace('tests="1" failures="1"', 'tests="2" failures="2"')
      .replace('</testsuite>', xml.match(/<testcase .*<\/testcase>/)[0] + '</testsuite>'));
    assert.equal(resultOf(run(fixture, [base, head])), 'FAIL');
  });

  test(`${profileId}: failures from different JUnit classes are new without file paths`, (t) => {
    const fixture = project(t), base = report(fixture, 'base', { sha: fixture.git('rev-parse', 'base'), failed: true });
    fixture.put('src/core/engine.ts', '// head\nexport function engine() { return 1; }\n');
    const head = report(fixture, 'head', { sha: fixture.commit('head'), failed: true });
    rewriteReport(fixture, base, '<testsuite name="suite"><testcase classname="ClassA" name="same"><failure/></testcase></testsuite>');
    rewriteReport(fixture, head, '<testsuite name="suite"><testcase classname="ClassB" name="same"><failure/></testcase></testsuite>');
    assert.equal(resultOf(run(fixture, [base, head])), 'FAIL');
  });

  for (const [staged, absolute] of [[true, false], [false, false], [true, true]]) test(`${profileId}: ${staged ? 'committed' : 'unstaged'} ${absolute ? 'absolute' : 'relative'} renamed JUnit file suites retain earlier failures`, (t) => {
    const fixture = project(t), base = report(fixture, 'base', { sha: fixture.git('rev-parse', 'base'), failed: true });
    const oldPath = join(fixture.root, 'test/engine.test.ts'), text = readFileSync(oldPath, 'utf8');
    if (absolute) rewriteReport(fixture, base, readFileSync(join(fixture.root, base.artifact), 'utf8').replaceAll('test/engine.test.ts', oldPath));
    fixture.put('test/moved.test.ts', text);
    rmSync(oldPath);
    const sha = staged ? fixture.commit('rename test') : fixture.git('rev-parse', 'HEAD');
    const head = report(fixture, 'head', { sha, failed: true });
    const movedPath = absolute ? join(fixture.root, 'test/moved.test.ts') : 'test/moved.test.ts';
    rewriteReport(fixture, head, readFileSync(join(fixture.root, head.artifact), 'utf8').replaceAll('test/engine.test.ts', movedPath),
      staged ? {} : { source: { sha, worktreeDigest: run(fixture, [], { head: 'worktree' }).head.worktreeDigest } });
    const results = run(fixture, [base, head], staged ? {} : { head: 'worktree' });
    assert.equal(results.executions[1].eligible, true);
    assert.equal(resultOf(results), 'PASS');
    assert.equal(resultOf(results, 'behavior.earlier-failures'), 'FAIL');
  });

  test(`${profileId}: reordered manifest object keys retain earlier failures`, (t) => {
    const fixture = project(t), base = report(fixture, 'base', { sha: fixture.git('rev-parse', 'base'), failed: true });
    fixture.put('src/core/engine.ts', '// head\nexport function engine() { return 1; }\n');
    const head = report(fixture, 'head', { sha: fixture.commit('head'), failed: true });
    const manifest = JSON.parse(readFileSync(join(fixture.root, head.manifest), 'utf8'));
    const reverse = (value) => Object.fromEntries(Object.entries(value).reverse());
    rewriteReport(fixture, head, readFileSync(join(fixture.root, head.artifact), 'utf8'), {
      tools: manifest.tools.map(reverse), environment: reverse(manifest.environment),
    });
    assert.equal(resultOf(run(fixture, [base, head])), 'PASS');
  });

  for (const kind of ['junit', 'jest-json', 'vitest-json']) test(`${profileId}: ${kind} count contradictions cannot certify failure checks`, (t) => {
    const fixture = project(t), input = report(fixture, 'head', { sha: fixture.git('rev-parse', 'HEAD'), failed: false });
    const text = kind === 'junit' ? '<testsuite tests="2" failures="1"><testcase name="pass"/></testsuite>'
      : JSON.stringify({ numTotalTests: 2, numFailedTests: 1, testResults: [{ name: 'test/engine.test.ts', assertionResults: [{ title: 'pass', status: 'passed' }] }] });
    rewriteReport(fixture, input, text);
    const manifest = JSON.parse(readFileSync(join(fixture.root, input.manifest), 'utf8'));
    manifest.artifacts[0].kind = kind;
    fixture.put(input.manifest, JSON.stringify(manifest));
    const results = run(fixture, [input]);
    assert.equal(results.executions[0].eligible, false);
    assert.equal(resultOf(results), 'UNKNOWN');
  });

  for (const kind of ['jest-json', 'vitest-json']) test(`${profileId}: ${kind} file failures without failed cases cannot certify failure checks`, (t) => {
    const fixture = project(t), input = report(fixture, 'head', { sha: fixture.git('rev-parse', 'HEAD'), failed: false });
    const text = JSON.stringify({ testResults: [{ name: 'test/engine.test.ts', status: 'failed', message: 'Failed to collect tests', assertionResults: [] }] });
    rewriteReport(fixture, input, text);
    const manifest = JSON.parse(readFileSync(join(fixture.root, input.manifest), 'utf8'));
    manifest.artifacts[0].kind = kind;
    fixture.put(input.manifest, JSON.stringify(manifest));
    const results = run(fixture, [input]);
    assert.equal(results.executions[0].eligible, false);
    assert.equal(resultOf(results), 'UNKNOWN');
  });
}
for (const move of [false, true]) test(`outside-root ${move ? 'rename' : 'deletion'} keeps the consumer check UNKNOWN`, (t) => {
  const fixture = project(t), { root, put, commit, request, verify } = fixture;
  put('.code-map.json', JSON.stringify({ roots: ['src'] }));
  put('scripts/a.ts', 'export const a = 1;\n');
  put('scripts/consumer.ts', "import { a } from './a'; export const consumer = a;\n");
  const base = commit('outside sources');
  if (move) renameSync(join(root, 'scripts/a.ts'), join(root, 'src/a.ts'));
  else rmSync(join(root, 'scripts/a.ts'));
  commit('remove outside target');
  const results = resultsOf(summaryOf(verify(request({ base, allowedPaths: ['**'] })), 3));
  const check = results.obligations.find((item) => item.id === 'completeness.consumers-updated');
  assert.equal(check.result, 'UNKNOWN');
  assert.ok(check.evidenceIds.includes('path:scripts/consumer.ts'));
});

for (const profileId of ['static-baseline-v0', 'evidence-v1']) test(`${profileId}: working-folder architecture rules cannot block a head commit`, (t) => {
  const { put, request, verify, commit } = project(t);
  put('.code-map.json', JSON.stringify({ rules: [] }));
  const base = commit('no architecture rules');
  put('src/core/engine.ts', "import { view } from '../ui/view';\nexport function engine() { return view().length; }\n");
  commit('valid new import');
  put('.code-map.json', JSON.stringify({ rules: ['core -> ui'] }));
  const results = resultsOf(summaryOf(verify(request({ base, profileId, ratingRulesVersion: profileId === 'evidence-v1' ? 'ratings-v1' : 'ratings-v0' })), 3));
  const check = results.obligations.find((item) => item.id === 'structure.architecture-rules');
  assert.deepEqual([check.result, check.eligible], ['UNKNOWN', false]);
  assert.ok(!results.ratings.structuralIntegrity.failures.includes('si.new-architecture-break'));
  assert.equal(results.ratings.structuralIntegrity.value, 2);
  assert.ok(results.ratings.structuralIntegrity.predicates.unknown.includes('si.rules-declared'));
  assert.ok(results.ratings.structuralIntegrity.predicates.unknown.includes('si.no-rule-finding-on-change'));
});

test('an unreadable renamed test keeps removal evidence UNKNOWN', (t) => {
  const { git, commit, request, verify } = project(t);
  git('mv', 'test/engine.test.ts', 'test/engine.test.sh');
  commit('rename test to unreadable script');
  const results = resultsOf(summaryOf(verify(request()), 3));
  const check = results.obligations.find((item) => item.id === 'completeness.tests-not-weakened');
  assert.equal(check.result, 'UNKNOWN');
  assert.ok(check.evidenceIds.includes('path:test/engine.test.sh'));
});

for (const flag of ['--assume-unchanged', '--skip-worktree']) test(`verify includes ${flag} edits in the change without changing Git`, (t) => {
  const { root, put, git, request, verify } = project(t);
  git('update-index', flag, 'src/core/engine.ts');
  put('src/core/engine.ts', 'export function engine() { return 20; }\n');
  const before = snapshot(root);
  const results = resultsOf(summaryOf(verify(request({ head: 'worktree', allowedPaths: ['test/**'] })), 3));
  assert.deepEqual(results.change.paths, ['src/core/engine.ts']);
  assert.equal(results.obligations.find((item) => item.id === 'scope.allowed-paths').result, 'FAIL');
  assert.deepEqual(snapshot(root), before);
});
