// Information from the bound test reports of a verification run (C19, C10): flaky cases across head reports of one run,
// cases that became slower than in the base report of the same run, and the discovered test inventory that ran or did not.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { testRuns } from '../lib/test-runs.mjs';

const run = (command) => ({ command: ['npx', 'vitest', ...command], workingDirectory: '.', tools: [{ name: 'vitest', version: '3.2.4' }], environment: { policy: 'local', node: '22', platform: 'linux', os: 'Linux', osVersion: '6', architecture: 'arm64', typescript: '6.0.3' } });
const item = (file, name, status, duration = null, suite = null) => ({ file, suite, name, status, duration });
const report = (artifact, cases, command = ['run']) => ({ artifact, kind: 'junit', filtered: false, exitStatus: 0, run: run(command), cases });
const none = { head: [], base: [], ineligible: [] };

test('a case that passed in one head report and failed in another of the same run is flaky, and other runs do not count', () => {
  const head = [
    report('reports/a.xml', [item('test/a.test.ts', 'adds', 'failed'), item('test/a.test.ts', 'parses', 'passed'), item('test/a.test.ts', 'skips', 'skipped')]),
    report('reports/b.xml', [item('test/a.test.ts', 'adds', 'passed'), item('test/a.test.ts', 'parses', 'errored'), item('test/a.test.ts', 'skips', 'passed')]),
    report('reports/c.xml', [item('test/a.test.ts', 'adds', 'passed'), item('test/a.test.ts', 'other', 'failed')], ['run', '--shard=2/2']),
    report('reports/d.xml', [item('test/a.test.ts', 'other', 'passed')], ['run', '--shard=1/2']),
  ];
  const { flaky } = testRuns({ ...none, head }, [], []);
  assert.deepEqual(flaky, { total: 2, entries: [
    { file: 'test/a.test.ts', suite: null, name: 'adds', passed: 1, failed: 1, artifacts: ['reports/a.xml', 'reports/b.xml'] },
    { file: 'test/a.test.ts', suite: null, name: 'parses', passed: 1, failed: 1, artifacts: ['reports/a.xml', 'reports/b.xml'] }] },
  'a skipped attempt is neither a pass nor a failure, and two reports of different commands are not attempts of one run');
  assert.deepEqual(testRuns({ ...none, head: head.slice(0, 1) }, [], []).flaky, { total: 0, entries: [] }, 'one report has no other attempt');
  const each = [item('test/a.test.ts', 'adds', 'passed'), item('test/a.test.ts', 'adds', 'failed')];
  assert.deepEqual(testRuns({ ...none, head: [{ ...report('reports/a.xml', each), kind: 'vitest-json' }, { ...report('reports/b.xml', each), kind: 'vitest-json' }] }, [], []).flaky, { total: 0, entries: [] },
    'two cases with one name in one report (test.each) are two cases, and each one has the same result in both reports');
});

test('a case is slower when its head duration is more than twice and more than 100 ms above the base report of the same run', () => {
  const base = [report('reports/base.xml', [item('test/a.test.ts', 'twice', 'passed', 100), item('test/a.test.ts', 'short', 'passed', 100), item('test/a.test.ts', 'small', 'passed', 10),
    item('test/a.test.ts', 'jump', 'passed', 60), item('test/a.test.ts', 'untimed', 'passed', null), item('test/old.test.ts', 'moved', 'passed', 50, 'suite')]),
  report('reports/other.xml', [item('test/a.test.ts', 'short', 'passed', 1)], ['run', '--bail'])];
  const head = [report('reports/a.xml', [item('test/a.test.ts', 'twice', 'passed', 300), item('test/a.test.ts', 'short', 'passed', 190), item('test/a.test.ts', 'small', 'passed', 90),
    item('test/a.test.ts', 'jump', 'passed', 200), item('test/a.test.ts', 'untimed', 'passed', 900), item('test/new.test.ts', 'moved', 'passed', 400, 'suite'), item('test/a.test.ts', 'fresh', 'passed', 999)]),
  report('reports/b.xml', [item('test/a.test.ts', 'twice', 'passed', 250)])];
  const { slower } = testRuns({ ...none, head, base }, [], [{ path: 'test/new.test.ts', status: 'R', from: 'test/old.test.ts' }]);
  assert.deepEqual(slower, { total: 3, entries: [
    { file: 'test/a.test.ts', suite: null, name: 'jump', baseMs: 60, headMs: 200 },
    { file: 'test/a.test.ts', suite: null, name: 'twice', baseMs: 100, headMs: 250 },
    { file: 'test/new.test.ts', suite: 'suite', name: 'moved', baseMs: 50, headMs: 400 }] },
  'the fastest head attempt counts against the slowest base attempt, and a base report of another command does not count');
  assert.deepEqual(testRuns({ ...none, head }, [], []).slower, { total: 0, entries: [] }, 'without a base report of the same run, no case is slower');
});

test('a discovery report gives the denominator: the discovered files and cases that ran in the bound head test reports and those that did not', () => {
  const discovery = [{ artifact: 'reports/list.json', kind: 'vitest-list', filtered: false, files: ['test/a.test.ts', 'test/b.test.ts', 'test/c.test.ts'],
    cases: [{ file: 'test/a.test.ts', name: 'sum > adds' }, { file: 'test/a.test.ts', name: 'parses' }, { file: 'test/b.test.ts', name: 'waits' }, { file: 'test/c.test.ts', name: 'never' }] },
  { artifact: 'reports/jest-list.json', kind: 'jest-list', filtered: true, files: ['test/c.test.ts', 'test/d.test.ts'], cases: null }];
  const head = [report('reports/a.xml', [item('test/a.test.ts', 'adds', 'passed', 1, 'sum'), item('test/a.test.ts', 'parses', 'failed'), item('test/b.test.ts', 'waits', 'skipped'), item(null, 'lost', 'passed'), item(null, 'parked', 'skipped')]),
    report('reports/b.xml', [item('test/d.test.ts', 'other', 'passed')])];
  assert.deepEqual(testRuns({ ...none, head }, discovery, []).discovery, {
    reports: ['reports/list.json', 'reports/jest-list.json'], filtered: true,
    files: { total: 4, ran: 2, notRan: 2, ranPaths: ['test/a.test.ts', 'test/d.test.ts'], notRanPaths: ['test/b.test.ts', 'test/c.test.ts'] },
    cases: { total: 4, ran: 2, notRan: 2, notRanNames: ['test/b.test.ts > waits', 'test/c.test.ts > never'] }, unnamedCases: 1 });
  const files = testRuns(none, [discovery[1]], []).discovery;
  assert.deepEqual([files.files.notRan, files.cases, files.unnamedCases], [2, null, 0], 'without a vitest list there is no case denominator');
  assert.equal(testRuns(none, [], []).discovery, null);
});

test('each list in the results keeps at most 50 entries, with the total', () => {
  const many = Array.from({ length: 60 }, (_, index) => `test/${String(index).padStart(2, '0')}.test.ts`);
  const head = [report('reports/a.xml', many.map((file) => item(file, 'flaps', 'failed'))), report('reports/b.xml', many.map((file) => item(file, 'flaps', 'passed')))];
  const result = testRuns({ ...none, head }, [{ artifact: 'reports/list.json', kind: 'jest-list', filtered: false, files: [...many, 'test/zz.test.ts'], cases: null }], []);
  assert.deepEqual([result.flaky.total, result.flaky.entries.length], [60, 50]);
  assert.deepEqual([result.discovery.files.ran, result.discovery.files.ranPaths.length, result.discovery.files.notRanPaths], [60, 50, ['test/zz.test.ts']]);
});


test('discovery counts duplicate executions once per position and keeps suites distinct', () => {
  const discovery = [{ artifact: 'list.json', files: ['test/a.test.ts'], filtered: false, cases: [
    { file: 'test/a.test.ts', name: 'sum > adds' }, { file: 'test/a.test.ts', name: 'sum > adds' },
    { file: 'test/a.test.ts', name: 'adds' }] }];
  const cases = [item('test/a.test.ts', 'adds', 'passed', 10, 'sum'), item('test/a.test.ts', 'adds', 'skipped', null, 'sum')];
  const found = testRuns({ ...none, head: [report('a.xml', cases), report('b.xml', cases)] }, discovery, []).discovery;
  assert.deepEqual(found.cases, { total: 3, ran: 1, notRan: 2, notRanNames: ['test/a.test.ts > sum > adds', 'test/a.test.ts > adds'] });
});

test('timing compares duplicate case names by position, including skipped positions', () => {
  const base = [report('base.xml', [item('test/a.test.ts', 'adds', 'passed', 20), item('test/a.test.ts', 'adds', 'passed', 500)])];
  const head = [report('head.xml', [item('test/a.test.ts', 'adds', 'passed', 200), item('test/a.test.ts', 'adds', 'skipped')])];
  assert.deepEqual(testRuns({ ...none, base, head }, [], []).slower, { total: 1, entries: [
    { file: 'test/a.test.ts', suite: null, name: 'adds', baseMs: 20, headMs: 200 }] });
});

test('run identity uses tool and environment values regardless of JSON property order', () => {
  const first = report('a.xml', [item('test/a.test.ts', 'adds', 'failed')]);
  const second = report('b.xml', [item('test/a.test.ts', 'adds', 'passed')]);
  second.run.environment = Object.fromEntries(Object.entries(first.run.environment).reverse());
  second.run.tools = [{ version: '3.2.4', name: 'vitest' }];
  assert.equal(testRuns({ ...none, head: [first, second] }, [], []).flaky.total, 1);
});

test('each discovery report joins command words and its own side only', () => {
  const list = { artifact: 'list.json', kind: 'vitest-list', side: 'base', run: run(['list', '--json']), filtered: false,
    files: ['a.ts'], cases: [{ file: 'a.ts', name: 'adds' }, { file: 'a.ts', name: 'skipped' }] };
  const base = report('base.xml', [item('a.ts', 'adds', 'passed'), item('a.ts', 'skipped', 'skipped')]);
  base.filtered = true;
  const wrong = report('other.xml', [item('a.ts', 'skipped', 'passed')], ['run', '--shard=2/2']);
  const result = testRuns({ ...none, base: [base, wrong], head: [report('head.xml', [item('a.ts', 'skipped', 'passed')])] }, [list], []);
  assert.deepEqual(result.discoveryAttestations[0], { artifact: 'list.json', side: 'base', reports: ['base.xml'], filtered: true,
    discovered: 2, ran: 1, notRan: 1, unit: 'cases' });
});
test('JUnit retries within one report remain flaky and keep each attempt', () => {
  const head = [report('retry.xml', [item('a.ts', 'adds', 'failed'), item('a.ts', 'adds', 'passed')])];
  const result = testRuns({ ...none, head }, [], []);
  assert.equal(result.flaky.total, 1);
  assert.deepEqual([result.flaky.entries[0].passed, result.flaky.entries[0].failed], [1, 1]);
  assert.equal(head[0].cases.length, 2);
});

test('unrelated commands cannot inflate the aggregate discovered numerator', () => {
  const discovery = [{ artifact: 'list.json', kind: 'vitest-list', side: 'head', run: run(['list', '--json']), filtered: false,
    files: ['a.ts'], cases: [{ file: 'a.ts', name: 'adds' }] }];
  const head = [report('wrong.xml', [item('a.ts', 'adds', 'passed')], ['run', '--shard=2/2'])];
  const result = testRuns({ ...none, head }, discovery, []);
  assert.equal(result.discovery.cases.ran, 0);
  assert.equal(result.discoveryAttestations[0].ran, 0);
});

test('Mocha aggregate and per-report attestation use the same full-title separator', () => {
  const list = { artifact: 'mocha.json', kind: 'mocha-list', side: 'head', run: { ...run([]), command: ['mocha', '--dry-run', '--reporter', 'json'] },
    filtered: false, files: ['a.ts'], cases: [{ file: 'a.ts', name: 'math adds' }] };
  const head = [{ ...report('head.xml', [item('a.ts', 'adds', 'passed', 1, 'math')]), run: { ...run([]), command: ['mocha', '--reporter', 'junit'] } }];
  const result = testRuns({ ...none, head }, [list], []);
  assert.equal(result.discoveryAttestations[0].ran, 1);
  assert.equal(result.discovery.cases.ran, 1);
});
test('command words after the option terminator retain discovery-like selection arguments', () => {
  const list = { artifact: 'list.json', kind: 'vitest-list', side: 'head', run: run(['list', '--json', '--', '--list']),
    filtered: false, files: ['a.ts'], cases: [{ file: 'a.ts', name: 'adds' }] };
  const result = testRuns({ ...none, head: [report('head.xml', [item('a.ts', 'adds', 'passed')], ['run', '--'])] }, [list], []);
  assert.equal(result.discoveryAttestations[0].ran, 0);
});

for (const field of ['policy', 'node', 'platform', 'os', 'osVersion', 'architecture', 'typescript']) {
  test(`incompatible ${field} prevents repeatability and timing comparisons`, () => {
    const base = report('base.xml', [item('test/a.test.ts', 'one', 'passed', 10)]);
    const head = report('head.xml', [item('test/a.test.ts', 'one', 'failed', 400)]);
    head.run.environment[field] = 'different';
    const result = testRuns({ ...none, base: [base], head: [base, head] }, [], []);
    assert.equal(result.flaky.total, 0);
    assert.equal(result.slower.total, 0);
    assert.equal(result.comparisons.entries.at(-1).state, 'INCOMPARABLE');
  });
}
test('missing historical environment fields leave comparisons unknown', () => {
  const base = report('base.xml', [item('test/a.test.ts', 'one', 'passed', 10)]);
  const head = report('head.xml', [item('test/a.test.ts', 'one', 'failed', 400)]);
  delete base.run.environment.osVersion;
  delete head.run.environment.osVersion;
  const result = testRuns({ ...none, base: [base], head: [base, head] }, [], []);
  assert.equal(result.flaky.total, 0);
  assert.equal(result.slower.total, 0);
  assert.equal(result.comparisons.entries[0].state, 'UNKNOWN');
  assert.deepEqual(result.comparisons.entries[0].missingFields, ['osVersion']);
});

test('missing head-only repeatability facts disclose an unknown comparison', () => {
  const first = report('first.xml', [item('test/a.test.ts', 'one', 'passed')]);
  const second = report('second.xml', [item('test/a.test.ts', 'one', 'failed')]);
  delete first.run.environment.architecture;
  delete second.run.environment.architecture;
  const result = testRuns({ ...none, head: [first, second] }, [], []);
  assert.equal(result.flaky.total, 0);
  assert.equal(result.comparisons.total, 1);
  assert.equal(result.comparisons.entries[0].state, 'UNKNOWN');
  assert.deepEqual(result.comparisons.entries[0].missingFields, ['architecture']);
});

test('Mocha pending cases stay in discovery denominators without execution credit', async () => {
  const { parseTestList } = await import('../lib/adapters/test-list.mjs');
  const parsed = parseTestList(JSON.stringify({ tests: [{ file: 'active.ts', fullTitle: 'active' }],
    pending: [{ file: 'pending.ts', fullTitle: 'later' }] }), { format: 'mocha-list', repository: '/repo' });
  const list = { ...parsed.report, artifact: 'list.json', kind: 'mocha-list', filtered: false, run: run(['run']) };
  const result = testRuns({ ...none, head: [report('results', [item('active.ts', 'active', 'passed')])] }, [list], []);
  assert.equal(result.discovery.files.total, 2);
  assert.equal(result.discovery.cases.total, 2);
  assert.equal(result.discovery.cases.notRan, 1);
  assert.equal(result.discoveryAttestations[0].discovered, 2);
  assert.equal(result.discoveryAttestations[0].ran, 1);
});
