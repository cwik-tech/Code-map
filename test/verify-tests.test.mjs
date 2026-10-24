// Acceptance tests of the test information of `code-map verify` through the CLI (C27, C19, C10): weaker assertions and runner
// settings, flaky and slower cases, and the discovered test inventory. The section `tests` of the results is information:
// it changes no check, rating or readiness state.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderReport } from '../lib/verify-report.mjs';

const cli = fileURLToPath(new URL('../bin/code-map.mjs', import.meta.url));
const valid = { requestType: 'code-map-verification-request', schemaVersion: 1, base: 'base', head: 'HEAD', intent: 'Change the engine tests.', acceptanceCriteria: [],
  allowedPaths: ['src/**', 'test/**', 'vitest.config.ts'], changeType: 'other', profileId: 'static-baseline-v0', ratingRulesVersion: 'ratings-v0', reportInputs: [],
  execution: { enabled: false, authorization: null, budgets: { wallClockSeconds: 60, memoryMegabytes: 512, outputMegabytes: 8, concurrency: 1 } } };
const header = "import { test, expect } from 'vitest';\nimport { engine } from '../src/core/engine';\n";
const engineTests = `${header}test('engine returns one', () => {\n  expect.assertions(2);\n  expect(engine()).toBe(1);\n  expect(engine(2)).toBe(2);\n});\n`
  + "test('engine keeps the value', () => {\n  expect(engine(3)).toEqual(3);\n});\n";
const config = (lines, extra = '') => `import { defineConfig } from 'vitest/config';\n\nexport default defineConfig({ test: { coverage: { thresholds: { lines: ${lines} } }${extra} } });\n`;
/** A JUnit report of the engine tests: [name, failed, seconds] for each case. */
const junit = (cases) => '<?xml version="1.0"?>\n<testsuites><testsuite name="test/engine.test.ts">'
  + cases.map(([name, failed, time]) => `<testcase classname="test/engine.test.ts" file="test/engine.test.ts" name="${name}" time="${time}">${failed ? '<failure message="expected 2 to be 1"/>' : ''}</testcase>`).join('')
  + '</testsuite></testsuites>\n';

/** A committed TypeScript project with two test files and a Vitest configuration. Git ignores reports/. The tag "base" names its commit. */
function project(t) {
  const root = mkdtempSync(join(tmpdir(), 'code-map-verify-tests-')), work = mkdtempSync(join(tmpdir(), 'code-map-verify-tests-work-'));
  t.after(() => { rmSync(root, { recursive: true, force: true }); rmSync(work, { recursive: true, force: true }); });
  const put = (path, text) => { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), text); };
  const git = (...args) => execFileSync('git', ['-C', root, '-c', 'user.name=test', '-c', 'user.email=test@example.com', ...args], { encoding: 'utf8' }).trim();
  put('.gitignore', 'reports/\n');
  put('src/core/engine.ts', 'export function engine(n = 1) { return n; }\n');
  put('test/engine.test.ts', engineTests);
  put('test/other.test.ts', "import { test, expect } from 'vitest';\ntest('other works', () => { expect(1).toBe(1); });\n");
  put('vitest.config.ts', config(80));
  git('init', '-q', '-b', 'main'); git('add', '.'); git('commit', '-qm', 'base'); git('tag', 'base');
  const run = (args) => spawnSync(process.execPath, [cli, ...args], { cwd: root, encoding: 'utf8', timeout: 60000 });
  /** Writes a report and its manifest with `code-map manifest`, and returns the pair for reportInputs. */
  const bind = (artifact, kind, text, exitStatus = '0', words = ['npx', 'vitest', 'run']) => {
    put(artifact, text);
    const manifest = artifact.replace(/\.[a-z]+$/, '.manifest.json');
    const written = run(['manifest', '--artifact', artifact, '--kind', kind, '--exit-status', exitStatus, '--out', manifest, '--', ...words]);
    assert.equal(written.status, 0, written.stderr);
    return { artifact, manifest };
  };
  let count = 0;
  const verify = (fields, code) => {
    const path = join(work, `request-${count++}.json`);
    writeFileSync(path, JSON.stringify({ ...valid, ...fields }));
    const output = run(['verify', '--request', path, '--store', join(work, 'store'), '--out-dir', join(work, 'out')]);
    assert.equal(output.status, code, output.stderr);
    const summary = JSON.parse(output.stdout);
    return { results: JSON.parse(readFileSync(summary.files.results, 'utf8')), markdown: readFileSync(summary.files.report, 'utf8') };
  };
  const commit = (message) => { git('add', '.'); git('commit', '-qm', message); };
  return { root, put, bind, verify, commit };
}

const row = (markdown, name) => markdown.split('\n').find((line) => line.startsWith(`| ${name} |`));

test('weaker assertions and a weaker runner setting are information in the results, and the check "Tests are not weakened" keeps its result', (t) => {
  const { put, verify, commit } = project(t);
  put('test/engine.test.ts', `${header}test('engine returns one', () => {\n  expect(engine()).toBe(1);\n});\n`
    + "test('engine keeps the value', () => {\n  expect(engine(3)).toBeTruthy();\n});\n");
  put('vitest.config.ts', config(70, ', passWithNoTests: true'));
  commit('head');
  const { results, markdown } = verify({}, 3);

  assert.deepEqual(results.tests.assertionWeakening.entries.map((entry) => [entry.kind, entry.name, entry.base.text, entry.head.text]), [
    ['fewer-assertions', 'engine returns one', 'expect(engine(2)).toBe(2)', null],
    ['plan-removed', 'engine returns one', 'expect.assertions(2)', null],
    ['looser-matcher', 'engine keeps the value', 'expect(engine(3)).toEqual(3)', 'expect(engine(3)).toBeTruthy()'],
  ]);
  assert.deepEqual([results.tests.assertionWeakening.files, results.tests.assertionWeakening.total, results.tests.assertionWeakening.unread], [1, 3, []]);
  assert.deepEqual(results.tests.runnerSettings.entries.map((entry) => [entry.path, entry.state, entry.changes.map((change) => `${change.setting} ${change.change}`)]),
    [['vitest.config.ts', 'WEAKER', ['test.coverage.thresholds.lines lowered', 'test.passWithNoTests enabled']]]);
  const check = results.obligations.find((item) => item.id === 'completeness.tests-not-weakened');
  assert.deepEqual([check.result, check.rationale], ['PASS', 'No active test case of the base is gone or weaker in the head.'],
    'the accepted rule set limits the check to removed, parked, empty and error-ignoring cases');
  const information = row(markdown, 'Test information');
  assert.ok(information, 'the report names the test information');
  assert.match(information, /Code-map compared the kept test cases of 1 changed test file\. 3 assertion changes make test cases weaker: `test\/engine\.test\.ts > engine returns one` \(fewer assertions\)/);
  assert.match(information, /1 runner configuration is weaker: `vitest\.config\.ts`/);
  assert.match(information, /No check reads this information/);
  assert.doesNotMatch(information, /[;—]|\b(should|may|might|could)\b/i);
});

test('a case that failed in one head report and passed in another is flaky, the failure still blocks, and a slower case is listed', (t) => {
  const { put, bind, verify, commit } = project(t);
  const base = bind('reports/base.xml', 'junit', junit([['engine returns one', false, '0.05'], ['engine keeps the value', false, '0.2']]));
  put('src/core/engine.ts', 'export function engine(n = 1) { return n + 0; }\n');
  commit('head');
  const first = bind('reports/first.xml', 'junit', junit([['engine returns one', true, '0.4'], ['engine keeps the value', false, '0.25']]), '1');
  const second = bind('reports/second.xml', 'junit', junit([['engine returns one', false, '0.3'], ['engine keeps the value', false, '0.21']]));
  const { results, markdown } = verify({ reportInputs: [first, second, base] }, 2);

  assert.deepEqual(results.executions.map((item) => [item.artifact, item.side, item.eligible]), [['reports/first.xml', 'head', true], ['reports/second.xml', 'head', true], ['reports/base.xml', 'base', true]]);
  const failures = results.obligations.find((item) => item.id === 'behavior.no-new-failures');
  assert.deepEqual([failures.result, failures.evidenceIds], ['FAIL', ['case:reports/first.xml:test/engine.test.ts > engine returns one']], 'a passed retry never replaces the failed attempt');
  assert.deepEqual(results.tests.flaky, { total: 1, entries: [{ file: 'test/engine.test.ts', suite: 'test/engine.test.ts', name: 'engine returns one', passed: 1, failed: 1,
    artifacts: ['reports/first.xml', 'reports/second.xml'] }] });
  assert.deepEqual(results.tests.slower, { total: 1, entries: [{ file: 'test/engine.test.ts', suite: 'test/engine.test.ts', name: 'engine returns one', baseMs: 50, headMs: 300 }] },
    'the other case is within the limits: 210 ms is not more than twice 200 ms');
  assert.match(row(markdown, 'Test information'), /1 test case is flaky: `test\/engine\.test\.ts > engine returns one` passed 1 time and failed 1 time/);
  assert.match(row(markdown, 'Test information'), /1 test case is slower than in the base report of the same run: `test\/engine\.test\.ts > engine returns one` from 50 ms to 300 ms/);
});

test('a bound discovery report of the head gives the discovered test files and cases, with those that ran and those that did not', (t) => {
  const { root, put, bind, verify, commit } = project(t);
  const real = realpathSync(root), list = (cases) => JSON.stringify(cases.map(([file, name]) => ({ name, file: join(real, file) })));
  const early = bind('reports/early.json', 'vitest-list', list([['test/engine.test.ts', 'engine returns one']]));
  put('src/core/engine.ts', 'export function engine(n = 1) { return n + 0; }\n');
  commit('head');
  const tests = bind('reports/junit.xml', 'junit', junit([['engine returns one', false, '0.01'], ['engine keeps the value', false, '0.01']]));
  const vitest = bind('reports/vitest-list.json', 'vitest-list', list([['test/engine.test.ts', 'engine returns one'], ['test/engine.test.ts', 'engine keeps the value'], ['test/other.test.ts', 'other works']]));
  const jest = bind('reports/jest-list.json', 'jest-list', JSON.stringify(['test/engine.test.ts', join(real, 'test/other.test.ts'), '/elsewhere/x.test.ts']));
  const broken = bind('reports/broken.json', 'vitest-list', 'PASS test/engine.test.ts\n');
  const failed = bind('reports/failed.json', 'jest-list', '[]', '1');
  assert.equal(JSON.parse(readFileSync(join(root, vitest.manifest), 'utf8')).artifacts[0].kind, 'vitest-list');
  const { results, markdown } = verify({ reportInputs: [tests, vitest, jest, broken, failed, early] }, 3);

  const byArtifact = Object.fromEntries(results.executions.map((item) => [item.artifact, item]));
  assert.deepEqual([byArtifact['reports/vitest-list.json'].eligible, byArtifact['reports/vitest-list.json'].cases, byArtifact['reports/vitest-list.json'].discovered], [true, null, { files: 2, cases: 3, outside: 0 }]);
  assert.deepEqual(byArtifact['reports/jest-list.json'].discovered, { files: 2, cases: null, outside: 1 });
  assert.deepEqual(['reports/broken.json', 'reports/failed.json', 'reports/early.json'].map((artifact) => [byArtifact[artifact].eligible, byArtifact[artifact].reasons.map((reason) => reason.key)]),
    [[false, ['parse']], [false, ['exit-status']], [true, []]]);
  assert.deepEqual(results.tests.discovery, { reports: ['reports/vitest-list.json', 'reports/jest-list.json'], filtered: false,
    files: { total: 2, ran: 1, notRan: 1, ranPaths: ['test/engine.test.ts'], notRanPaths: ['test/other.test.ts'] },
    cases: { total: 3, ran: 2, notRan: 1, notRanNames: ['test/other.test.ts > other works'] }, unnamedCases: 0 });
  assert.equal(results.obligations.find((item) => item.id === 'coverage.head-run').rationale, 'The bound head reports ran 2 test cases.', 'a discovery report has no test case');
  assert.match(markdown, /`reports\/vitest-list\.json` \(vitest-list\) \| Head \| Yes, self-attested \| Discovered 2 test files and 3 test cases \|/);
  assert.match(row(markdown, 'Test information'), /The discovery reports found 2 test files and 3 test cases\. 1 test file ran in the bound head test reports, and 1 did not: `test\/other\.test\.ts`\. 1 discovered test case did not run/);
});

test('the row "Test information" puts each name from a report or a test file in a code span, and it is one line of the report', () => {
  const results = { intent: 'Change the tests.', readiness: { state: 'INSUFFICIENT_EVIDENCE', exitCode: 3, insufficient: [] }, obligations: [], comparison: { state: 'COMPARABLE', reasons: [] },
    base: { ref: 'base', sha: 'a'.repeat(40), analysisId: 'A-1' }, head: { ref: 'HEAD', sha: 'b'.repeat(40), analysisId: 'A-2' }, change: { total: 1 }, executions: [], limits: [], gaps: [],
    tests: { assertionWeakening: { files: 1, total: 1, entries: [{ kind: 'looser-matcher', path: 'test/a|b.test.ts', suite: '', name: '<script>alert(1)</script>\n| x |' }], unread: [] },
      runnerSettings: { files: 0, weaker: 0, unknown: 0, entries: [] }, flaky: { total: 0, entries: [] }, slower: { total: 0, entries: [] },
      discovery: { reports: [], filtered: false, files: { total: 1, ran: 0, notRan: 1, ranPaths: [], notRanPaths: ['test/`x`.test.ts'] }, cases: null, unnamedCases: 0 } } };
  const markdown = renderReport(results), line = row(markdown, 'Test information');
  assert.match(line, /`test\/a\\\|b\.test\.ts > <script>alert\(1\)<\/script> \\\| x \\\|`/, 'a name from a test file is a code span, so it cannot add HTML');
  assert.equal(line.split(/(?<!\\)\|/).length, 4, 'the row has two cells');
  assert.match(line, /0 test files ran in the bound head test reports, and 1 did not: ``test\/`x`\.test\.ts``\./);
  assert.equal(renderReport({ ...results, tests: undefined }).split('\n').length, markdown.split('\n').length - 1, 'older results without tests have no row');
});


test('verify binds new discovery kinds on both sides and discloses changed lockfile dependencies', (t) => {
  const { put, bind, verify, commit } = project(t);
  const lock = (version) => JSON.stringify({ lockfileVersion: 3, packages: { 'node_modules/demo': { version } } });
  put('package-lock.json', lock('1.0.0'));
  commit('lock base');
  const base = bind('reports/base.xml', 'junit', junit([['engine returns one', false, '0.1']]), '0', ['npx', 'mocha', '--reporter', 'junit']);
  const baseList = bind('reports/base-list.json', 'mocha-list', JSON.stringify({ tests: [{ file: 'test/engine.test.ts', fullTitle: 'engine returns one' }] }), '0', ['npx', 'mocha', '--dry-run', '--reporter', 'json']);
  put('package-lock.json', lock('2.0.0'));
  commit('lock head');
  const head = bind('reports/head.xml', 'junit', junit([['engine returns one', true, '0.1'], ['engine returns one', false, '0.1']]), '1', ['npx', 'playwright', 'test', '--reporter=junit']);
  const list = bind('reports/pw.json', 'playwright-list', JSON.stringify({ suites: [{ file: 'test/engine.test.ts', specs: [
    { file: 'test/engine.test.ts', title: 'engine returns one', tests: [{}] }] }] }), '0', ['npx', 'playwright', 'test', '--list', '--reporter=json']);
  const { results, markdown } = verify({ base: 'HEAD~1', reportInputs: [base, head, baseList, list] }, 2);
  assert.equal(results.tests.dependencies.lockfilesChanged, true);
  assert.equal(results.tests.dependencies.counts.upgraded, 1);
  assert.equal(results.tests.dependencies.examples[0].name, 'demo');
  assert.equal(results.tests.flaky.total, 1);
  const attempts = results.executions.find((entry) => entry.artifact === head.artifact);
  assert.deepEqual([attempts.cases, attempts.failed], [2, 1]);
  assert.deepEqual(results.tests.discoveryAttestations.map((entry) => [entry.side, entry.discovered, entry.ran]), [['base', 1, 1], ['head', 1, 1]]);
  assert.match(markdown, /lockfiles differ/);
  assert.match(markdown, /demo/);
});


test('equal lockfiles disclose no package changes in verify', (t) => {
  const { put, bind, verify, commit } = project(t);
  const base = bind('reports/base.xml', 'junit', junit([['engine returns one', false, '0.1']]));
  put('src/core/engine.ts', 'export function engine(n = 1) { return n + 0; }\n');
  commit('head');
  const head = bind('reports/head.xml', 'junit', junit([['engine returns one', false, '0.1']]));
  const { results, markdown } = verify({ reportInputs: [base, head] }, 3);
  assert.equal(results.tests.dependencies.compared, true);
  assert.equal(results.tests.dependencies.lockfilesChanged, false);
  assert.deepEqual(results.tests.dependencies.examples, []);
  assert.doesNotMatch(markdown, /lockfiles differ/);
});
