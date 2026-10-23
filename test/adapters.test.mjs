import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { analysisInputs } from '../lib/inputs.mjs';
import { loadConfig } from '../lib/project.mjs';
import { bindingStatus, validateManifest } from '../lib/adapters/run-manifest.mjs';
import { parseJUnit, supportedProducers as junitProducers } from '../lib/adapters/junit.mjs';
import { parseTestResults, supportedProducers as jsonProducers } from '../lib/adapters/test-results-json.mjs';

const hex = (char, length) => char.repeat(length);
const sha = hex('a', 40), worktree = hex('b', 64), config = hex('c', 64), lock = hex('d', 64), artifact = hex('e', 64);

function manifest(overrides = {}) {
  return {
    manifestType: 'code-map-run-manifest', schemaVersion: 1,
    source: { sha, worktreeDigest: worktree },
    command: ['npx', 'vitest', 'run', '--reporter=junit'], workingDirectory: '.',
    tools: [{ name: 'vitest', version: '3.2.4' }, { name: 'node', version: '24.21.0' }],
    config, lockfile: { path: 'package-lock.json', digest: lock },
    environment: { policy: 'restricted-worker-v1', node: '24.21.0', platform: 'darwin-arm64' },
    startedAt: '2026-10-22T18:00:00.000Z', finishedAt: '2026-10-22T18:00:05.250Z', exitStatus: 1,
    artifacts: [{ path: 'reports/junit.xml', digest: artifact, kind: 'junit' }],
    discovery: { scope: 'vitest run (all projects)', filters: [] },
    ...overrides,
  };
}

function inputs(overrides = {}) {
  return {
    manifestVersion: 1, repository: '/work/project', selector: { worktree: true, ref: null }, sha,
    worktree: { digest: hex('2', 64), entries: 3, contentDigest: worktree }, baseBranch: { name: 'main', sha: hex('f', 40) }, config,
    labels: { path: 'docs/code-map/test-labels.json', digest: null }, coverage: null,
    analyzer: { version: '1.0.0', source: hex('1', 64), typescript: '6.0.3', node: '24.21.0' },
    lockfile: { path: 'package-lock.json', digest: lock },
    ...overrides,
  };
}

test('a complete run manifest validates and is returned as an independent copy', () => {
  const value = manifest();
  const result = validateManifest(value);
  assert.equal(result.ok, true);
  assert.deepEqual(result.manifest, value);
  assert.notEqual(result.manifest, value);
  assert.equal(validateManifest(manifest({ lockfile: null, discovery: null, exitStatus: null, artifacts: [] })).ok, true);
  assert.equal(validateManifest(manifest({ source: { sha: hex('a', 64), worktreeDigest: null } })).ok, true, 'a SHA-256 repository has 64-character commit IDs');
  assert.equal(validateManifest(manifest({ source: { sha: hex('a', 52), worktreeDigest: null } })).ok, false);
});

test('manifest validation returns every error with its path, and unknown fields are errors', () => {
  const result = validateManifest(manifest({
    manifestType: 'other', schemaVersion: '1', source: { sha: 'abc', worktreeDigest: 7 }, command: [], tools: [{ name: '', version: '1' }],
    config: 'short', environment: { policy: 'p', node: 24, platform: null }, startedAt: 'yesterday', exitStatus: 1.5,
    artifacts: [{ path: 'r.xml', digest: artifact, kind: 'xml' }], discovery: { scope: 's', filters: [3] }, extra: true,
  }));
  assert.equal(result.ok, false);
  assert.deepEqual(result.errors.map((error) => error.path).sort(), [
    'artifacts[0].kind', 'command', 'config', 'discovery.filters[0]', 'environment.node', 'exitStatus', 'extra', 'manifestType',
    'schemaVersion', 'source.sha', 'source.worktreeDigest', 'startedAt', 'tools[0].name',
  ]);
  assert.ok(result.errors.every((error) => typeof error.message === 'string' && error.message.length > 0));
  assert.deepEqual(validateManifest(null).errors.map((error) => error.path), ['']);
  assert.deepEqual(validateManifest({}).errors.length, 14, 'each missing required field is reported');
});

test('working directories and artifact paths must stay inside the repository', () => {
  for (const path of ['/etc', '../outside', 'reports/../../x', 'C:\\temp', '\\\\server\\share', '', 'a\0b']) {
    const result = validateManifest(manifest({ workingDirectory: path, artifacts: [{ path, digest: artifact, kind: 'junit' }] }));
    assert.equal(result.ok, false, `${JSON.stringify(path)} must be rejected`);
    assert.deepEqual(result.errors.map((error) => error.path), ['workingDirectory', 'artifacts[0].path']);
  }
  const twice = validateManifest(manifest({ artifacts: [{ path: 'r.xml', digest: artifact, kind: 'junit' }, { path: 'r.xml', digest: artifact, kind: 'junit' }] }));
  assert.deepEqual(twice.errors.map((error) => error.path), ['artifacts[1].path']);
  assert.deepEqual(validateManifest(manifest({ finishedAt: '2026-10-22T17:59:59.000Z' })).errors.map((error) => error.path), ['finishedAt']);
});

test('a report is BOUND only when commit, worktree, config, lockfile and artifact digest all match', () => {
  assert.deepEqual(bindingStatus(manifest(), inputs(), { artifactDigest: artifact }), { state: 'BOUND', reasons: [] });
  const commit = manifest({ source: { sha, worktreeDigest: null } });
  assert.deepEqual(bindingStatus(commit, inputs({ selector: { worktree: false, ref: 'HEAD' }, worktree: null }), { artifactDigest: artifact }), { state: 'BOUND', reasons: [] });
  assert.equal(bindingStatus(manifest({ lockfile: null }), inputs({ lockfile: null }), { artifactDigest: artifact }).state, 'BOUND');
});

test('each mismatch makes the binding STALE and names its reason', () => {
  const cases = [
    ['sha', inputs({ sha: hex('9', 40) })],
    ['worktree', inputs({ worktree: { digest: worktree, entries: 1, contentDigest: hex('8', 64) } })],
    ['worktree', inputs({ worktree: null })],
    ['config', inputs({ config: hex('7', 64) })],
    ['lockfile', inputs({ lockfile: { path: 'package-lock.json', digest: hex('6', 64) } })],
    ['lockfile', inputs({ lockfile: null })],
  ];
  for (const [reason, current] of cases) {
    const result = bindingStatus(manifest(), current, { artifactDigest: artifact });
    assert.equal(result.state, 'STALE', reason);
    assert.deepEqual(result.reasons.map((item) => item.key), [reason]);
    assert.ok(result.reasons[0].message.length > 0);
  }
  const other = bindingStatus(manifest(), inputs(), { artifactDigest: hex('5', 64) });
  assert.deepEqual([other.state, other.reasons.map((item) => item.key)], ['STALE', ['artifact']]);
  const all = bindingStatus(manifest(), inputs({ sha: hex('9', 40), config: hex('7', 64) }), { artifactDigest: hex('5', 64) });
  assert.deepEqual(all.reasons.map((item) => item.key), ['sha', 'config', 'artifact']);
  assert.throws(() => bindingStatus(manifest(), inputs(), {}), TypeError);
});

test('a report without a valid manifest is UNBOUND and cannot satisfy readiness', () => {
  for (const missing of [null, undefined]) {
    const result = bindingStatus(missing, inputs(), { artifactDigest: artifact });
    assert.equal(result.state, 'UNBOUND');
    assert.deepEqual(result.reasons.map((item) => item.key), ['manifest']);
    assert.match(result.reasons[0].message, /readiness/);
  }
  const invalid = bindingStatus({ manifestType: 'code-map-run-manifest' }, inputs(), { artifactDigest: artifact });
  assert.equal(invalid.state, 'UNBOUND');
  assert.match(invalid.reasons[0].message, /invalid/);
});

const junit = `<?xml version="1.0" encoding="UTF-8"?>
<!-- produced by a runner -->
<testsuites name='all' tests="5" failures="1" errors="1" skipped="1" time="1.5">
  <testsuite name="parser" tests="4" failures="1" errors="1" skipped="1" time="1.25" timestamp="2026-10-22T18:00:00">
    <properties><property name="seed" value="42"/></properties>
    <testcase time="0.5" name="parses &quot;a&quot; &amp; b" classname='src/parse.test.ts' file="src/parse.test.ts"/>
    <testcase name="rejects empty input" classname="src/parse.test.ts" time="0.25">
      <failure message="expected &lt;error&gt;" type="AssertionError">at parse (src/parse.ts:2)</failure>
    </testcase>
    <testcase name="loads &#x1F600; config &#65;" classname="src/parse.test.ts" time="0.5"><error>TypeError: boom</error></testcase>
    <testcase name="later" classname="src/parse.test.ts" time="0"><skipped/></testcase>
    <system-out><![CDATA[<not markup> & not an entity]]></system-out>
  </testsuite>
  <testsuite name="nested-parent" tests="1" failures="0" errors="0" skipped="0">
    <testsuite name="child" tests="1"><testcase name="deep" classname="x"/></testsuite>
  </testsuite>
</testsuites>`;

test('JUnit cases keep their suite, class, file, status, time and failure message', () => {
  const result = parseJUnit(junit);
  assert.equal(result.ok, true, result.error);
  const { report } = result;
  assert.equal(report.format, 'junit');
  assert.deepEqual(report.cases.map((item) => [item.suite, item.name, item.status, item.time]), [
    ['parser', 'parses "a" & b', 'passed', 0.5],
    ['parser', 'rejects empty input', 'failed', 0.25],
    ['parser', 'loads \u{1F600} config A', 'errored', 0.5],
    ['parser', 'later', 'skipped', 0],
    ['child', 'deep', 'passed', null],
  ]);
  assert.deepEqual(report.cases[0], { suite: 'parser', classname: 'src/parse.test.ts', name: 'parses "a" & b', file: 'src/parse.test.ts', status: 'passed', todo: false, time: 0.5, message: null });
  assert.equal(report.cases[1].message, 'expected <error>');
  assert.equal(report.cases[2].message, 'TypeError: boom');
  assert.deepEqual(report.totals, { tests: 5, passed: 2, failed: 1, errored: 1, skipped: 1, todo: 0 });
  assert.deepEqual(report.suites.map((suite) => [suite.name, suite.tests, suite.failures, suite.errors, suite.skipped, suite.time]),
    [['parser', 4, 1, 1, 1, 1.25], ['nested-parent', 1, 0, 0, 0, null], ['child', 1, null, null, null, null]]);
  assert.deepEqual(report.mismatches, []);
  assert.ok(junitProducers.length > 0 && junitProducers.every((producer) => producer.name && producer.versions));
});

test('JUnit declarations of entities or a document type are rejected', () => {
  for (const text of [
    '<?xml version="1.0"?><!DOCTYPE testsuites [<!ENTITY x SYSTEM "file:///etc/passwd">]><testsuites>&x;</testsuites>',
    '<!ENTITY x "y"><testsuite name="a"/>',
  ]) {
    const result = parseJUnit(text);
    assert.equal(result.ok, false);
    assert.match(result.error, /DOCTYPE|ENTITY/);
  }
  assert.match(parseJUnit('<testsuite name="a"><testcase name="&nbsp;"/></testsuite>').error, /entity/);
});

test('malformed JUnit nesting, unclosed elements and misplaced cases are rejected', () => {
  for (const [text, pattern] of [
    ['<testsuite name="a"><testcase name="x"></testsuite></testcase>', /closes testcase|expected/],
    ['<testsuite name="a"><testcase name="x">', /not closed/],
    ['<testsuites><testcase name="x"/></testsuites>', /outside a testsuite/],
    ['<testsuite name="a"><failure/></testsuite>', /outside a testcase/],
    ['<testsuite name="a"/><testsuite name="b"/>', /root/],
    ['<report/>', /root/],
    ['<testsuite name="a"><testcase/></testsuite>', /name/],
    ['<testsuite name="a" name="b"/>', /twice/],
    ['<testsuite name="a <b"/>', /</],
    ['', /root/],
  ]) {
    const result = parseJUnit(text);
    assert.equal(result.ok, false, text);
    assert.match(result.error, pattern, text);
  }
  assert.equal(parseJUnit(42).ok, false);
});

test('JUnit inputs over the byte or case limit are rejected before they are used', () => {
  assert.match(parseJUnit(junit, { maxBytes: 100 }).error, /100 bytes/);
  assert.match(parseJUnit(junit, { maxCases: 4 }).error, /4 test cases/);
  assert.equal(parseJUnit(junit, { maxCases: 5 }).ok, true);
});

test('declared JUnit counts that do not match the cases are reported as mismatches', () => {
  const result = parseJUnit('<testsuite name="a" tests="3" failures="2"><testcase name="x"/><testcase name="y"><failure/></testcase></testsuite>');
  assert.equal(result.ok, true);
  assert.deepEqual(result.report.mismatches, [
    { suite: 'a', field: 'tests', declared: 3, observed: 2 },
    { suite: 'a', field: 'failures', declared: 2, observed: 1 },
  ]);
});

const jest = {
  numTotalTests: 5, numPassedTests: 1, numFailedTests: 1, numPendingTests: 2, numTodoTests: 1, success: false,
  testResults: [
    { name: '/work/project/src/parse.test.ts', status: 'failed', message: '', assertionResults: [
      { ancestorTitles: ['parse', 'input'], title: 'accepts text', fullName: 'parse input accepts text', status: 'passed', duration: 12, failureMessages: [] },
      { ancestorTitles: ['parse'], title: 'rejects empty', fullName: 'parse rejects empty', status: 'failed', duration: 3, failureMessages: ['Error: expected throw\n    at x'] },
      { ancestorTitles: [], title: 'later', fullName: 'later', status: 'pending', duration: null, failureMessages: [] },
      { ancestorTitles: [], title: 'one day', fullName: 'one day', status: 'todo', failureMessages: [] },
      { ancestorTitles: [], title: 'off', fullName: 'off', status: 'skipped', failureMessages: [] },
    ] },
    { name: 'test/broken.test.ts', status: 'failed', message: 'SyntaxError: Unexpected token', assertionResults: [] },
  ],
};

test('Jest and Vitest JSON results become repository-relative cases with skipped and todo kept apart', () => {
  const result = parseTestResults(jest, { repository: '/work/project', format: 'vitest-json' });
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  const { report } = result;
  assert.equal(report.format, 'vitest-json');
  assert.deepEqual(report.cases.map((item) => [item.file, item.suite, item.name, item.status, item.todo, item.time]), [
    ['src/parse.test.ts', 'parse > input', 'accepts text', 'passed', false, 0.012],
    ['src/parse.test.ts', 'parse', 'rejects empty', 'failed', false, 0.003],
    ['src/parse.test.ts', null, 'later', 'skipped', false, null],
    ['src/parse.test.ts', null, 'one day', 'skipped', true, null],
    ['src/parse.test.ts', null, 'off', 'skipped', false, null],
  ]);
  assert.equal(report.cases[1].message, 'Error: expected throw\n    at x');
  assert.deepEqual(report.files, [{ file: 'src/parse.test.ts', status: 'failed', message: null, cases: 5 }, { file: 'test/broken.test.ts', status: 'failed', message: 'SyntaxError: Unexpected token', cases: 0 }]);
  assert.deepEqual(report.totals, { tests: 5, passed: 1, failed: 1, errored: 0, skipped: 3, todo: 1 });
  assert.deepEqual(report.mismatches, []);
  assert.equal(parseTestResults(JSON.stringify(jest), { repository: '/work/project' }).report.format, 'jest-json');
  assert.ok(jsonProducers.length > 0);
});

test('test result paths outside the repository are rejected', () => {
  for (const name of ['/elsewhere/a.test.ts', '../a.test.ts', '/work/project-other/a.test.ts']) {
    const result = parseTestResults({ testResults: [{ name, assertionResults: [] }] }, { repository: '/work/project' });
    assert.equal(result.ok, false, name);
    assert.deepEqual(result.errors.map((error) => error.path), ['testResults[0].name']);
  }
});

test('malformed test result JSON returns every error with its path', () => {
  const result = parseTestResults({ numTotalTests: 'x', testResults: [{ name: 'a.test.ts', assertionResults: [{ title: 3, status: 'weird', ancestorTitles: 'no', failureMessages: [1], duration: 'slow' }] }, 7] }, { repository: '/work/project' });
  assert.equal(result.ok, false);
  assert.deepEqual(result.errors.map((error) => error.path), [
    'numTotalTests', 'testResults[0].assertionResults[0].title', 'testResults[0].assertionResults[0].status', 'testResults[0].assertionResults[0].ancestorTitles',
    'testResults[0].assertionResults[0].duration', 'testResults[0].assertionResults[0].failureMessages[0]', 'testResults[1]',
  ]);
  assert.deepEqual(parseTestResults('{not json', { repository: '/work/project' }).errors.map((error) => error.path), ['']);
  assert.deepEqual(parseTestResults({ testResults: [] }, { repository: 'relative/path' }).errors.map((error) => error.path), ['options.repository']);
  assert.deepEqual(parseTestResults({ testResults: [] }, { repository: '/work/project', format: 'mocha' }).errors.map((error) => error.path), ['options.format']);
  const declared = parseTestResults({ numTotalTests: 2, testResults: [{ name: 'a.test.ts', assertionResults: [{ title: 't', status: 'passed' }] }] }, { repository: '/work/project' });
  assert.deepEqual(declared.report.mismatches, [{ suite: null, field: 'numTotalTests', declared: 2, observed: 1 }]);
});

test('a run manifest built from the analysis inputs binds to them, for a commit and for a changed working tree, edited snapshots included', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'code-map-binding-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const put = (path, text) => writeFileSync(join(root, path), text);
  put('package-lock.json', '{"lockfileVersion":3}\n'); put('index.ts', 'export const a = 1;\n'); put('index.test.ts.snap', 'v1\n');
  const git = (...args) => execFileSync('git', ['-C', root, '-c', 'user.name=test', '-c', 'user.email=test@example.com', ...args], { encoding: 'utf8' });
  git('init', '-q'); git('add', '.'); git('commit', '-qm', 'fixture');
  const config = loadConfig(root), digest = 'a'.repeat(64), worktree = () => analysisInputs(root, config, { worktree: true }, null);
  const manifestFor = (inputs) => manifest({ source: { sha: inputs.sha, worktreeDigest: inputs.worktree?.contentDigest ?? null }, config: inputs.config,
    lockfile: inputs.lockfile, artifacts: [{ path: 'reports/junit.xml', digest, kind: 'junit' }] });
  const keys = (run, inputs) => bindingStatus(manifestFor(run), inputs, { artifactDigest: digest }).reasons.map((reason) => reason.key);
  const commit = analysisInputs(root, config, { ref: 'HEAD' }, 'HEAD'), clean = worktree();
  assert.equal(commit.lockfile.path, 'package-lock.json');
  assert.equal(clean.worktree.contentDigest, null, 'a clean working tree binds like its commit');
  assert.deepEqual([keys(commit, commit), keys(commit, clean)], [[], []]);
  const edit = (text) => { put('index.test.ts.snap', text); return worktree(); };
  const v2 = edit('v2\n'), v3 = edit('v3\n');
  assert.deepEqual([keys(v3, v3), keys(commit, v3), keys(v2, v3)], [[], ['worktree'], ['worktree']], 'a snapshot edit that the analysis does not read');
  put('index.ts', 'export const a = 2;\n');
  const changed = worktree();
  assert.deepEqual([keys(changed, changed), keys(commit, changed)], [[], ['worktree']]);
});

test('deeply nested suites and floods of malformed entries fail fast with a bounded error list', () => {
  const nested = '<testsuite name="s">'.repeat(5000) + '</testsuite>'.repeat(5000);
  const started = process.hrtime.bigint();
  const deep = parseJUnit(nested);
  assert.equal(deep.ok, false);
  assert.match(deep.error, /nested/);
  const flood = parseTestResults({ testResults: Array.from({ length: 50000 }, () => ({ name: '/elsewhere/a.test.ts', assertionResults: [] })) }, { repository: '/repo' });
  assert.equal(flood.ok, false);
  assert.ok(flood.errors.length <= 101, 'the error list is bounded');
  assert.match(flood.errors.at(-1).message, /more errors/);
  assert.ok(Number(process.hrtime.bigint() - started) / 1e6 < 2000, 'both inputs are rejected quickly');
});
