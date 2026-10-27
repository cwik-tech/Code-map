import assert from 'node:assert/strict';
import { test } from 'node:test';
import { testRuns } from '../lib/test-runs.mjs';
import { testsRow } from '../lib/verify-tests-text.mjs';
import { code, plain } from '../lib/verify-markdown.mjs';

const item = (name, status, file = 'test/a.test.ts', suite = 'suite') => ({ file, suite, name, status });
const report = (artifact, cases, command = ['node', '--test']) => ({ artifact, kind: 'junit', cases,
  run: { command, workingDirectory: '.', tools: [{ name: 'node', version: '22' }],
    environment: { policy: 'local', node: '22', platform: 'linux', os: 'Linux', osVersion: '6', architecture: 'arm64', typescript: '6.0.3' } } });
const compare = (base, head, files = []) => testRuns({ base, head }, [], files).outcomes;

test('base and head comparison reports passed, failed and skipped transitions of the same run', () => {
  const base = report('base.xml', [item('parked', 'passed'), item('absent', 'passed'), item('fixed', 'errored'), item('active', 'skipped'),
    item('moved', 'passed', 'test/old.test.ts'), item('deleted', 'passed', 'test/gone.test.ts'), item('broken', 'passed')]);
  const head = report('head.xml', [item('parked', 'skipped'), item('fixed', 'passed'), item('active', 'passed'),
    item('moved', 'skipped', 'test/new.test.ts'), item('broken', 'failed'), item('new', 'passed')]);
  const result = compare([base, report('other-base.xml', [item('unrelated', 'passed')], ['other'])],
    [head, report('other-head.xml', [item('absent', 'passed')], ['different'])],
    [{ status: 'R', from: 'test/old.test.ts', path: 'test/new.test.ts' }, { status: 'D', path: 'test/gone.test.ts' }]);
  assert.equal(result.state, 'COMPARED');
  assert.equal(result.total, 8);
  assert.deepEqual(result.counts, { 'passed>skipped': 2, 'passed>missing': 2, 'failed>passed': 1, 'skipped>passed': 1, 'passed>failed': 1, 'missing>passed': 1 });
  assert.deepEqual(result.entries.map(({ name, baseStatus, headStatus, deleted, file }) => [name, baseStatus, headStatus, deleted, file]), [
    ['absent', 'passed', 'missing', false, 'test/a.test.ts'], ['active', 'skipped', 'passed', false, 'test/a.test.ts'],
    ['broken', 'passed', 'failed', false, 'test/a.test.ts'], ['fixed', 'failed', 'passed', false, 'test/a.test.ts'],
    ['new', 'missing', 'passed', false, 'test/a.test.ts'], ['parked', 'passed', 'skipped', false, 'test/a.test.ts'],
    ['deleted', 'passed', 'missing', true, 'test/gone.test.ts'], ['moved', 'passed', 'skipped', false, 'test/new.test.ts']]);
});

test('outcomes remain unknown without a base report of the same run', () => {
  const base = report('base.xml', [item('one', 'passed')]);
  const head = report('head.xml', [item('one', 'skipped')], ['other']);
  assert.deepEqual(compare([base], [head]), { state: 'UNKNOWN', reason: 'No bound base and head reports have the same run identity.', counts: {}, total: 0, entries: [] });
  delete head.run.environment.osVersion;
  assert.equal(compare([base], [head]).state, 'UNKNOWN');
  assert.equal(compare([base], []).state, 'UNKNOWN');
});

test('outcomes use all paired attempts and never replace a failure with a pass', () => {
  const base = report('base.xml', [item('one', 'passed'), item('stable', 'passed')]);
  const first = report('first.xml', [item('one', 'failed')]);
  const retry = report('retry.xml', [item('one', 'passed'), item('stable', 'passed')]);
  assert.deepEqual(compare([base, base], [first, retry]).counts, { 'passed>failed': 1 });
  assert.deepEqual(compare([base], [retry]).counts, {});
  assert.equal(compare([base], [retry]).state, 'COMPARED');
});

test('outcome counts include all changes but the list keeps only 50 entries', () => {
  const cases = Array.from({ length: 60 }, (_, i) => item(`case-${i}`, 'passed'));
  const result = compare([report('base.xml', cases)], [report('head.xml', [])]);
  assert.deepEqual(result.counts, { 'passed>missing': 60 });
  assert.deepEqual([result.total, result.entries.length], [60, 50]);
  assert.deepEqual([result.basePassesLost.total, result.basePassesLost.entries.length], [60, 50]);
  assert.match(testsRow({ outcomes: result }, { code, plain }), /and 57 more/);
});

test('the report names lost base passes even when other transitions fill the case list', () => {
  const base = report('base.xml', [item('lost', 'passed', 'test/z.test.ts')]);
  const head = report('head.xml', Array.from({ length: 55 }, (_, i) => item(`new-${i}`, 'passed')));
  const outcomes = compare([base], [head]);
  assert.match(testsRow({ outcomes }, { code, plain }), /Base passes that are now skipped or missing: `test\/z\.test\.ts > suite > lost`/);
});

test('new head cases count passed, failed and skipped outcomes separately', () => {
  const result = compare([report('base.xml', [])], [report('head.xml', [
    item('pass', 'passed'), item('error', 'errored'), item('skip', 'skipped'),
  ])]);
  assert.deepEqual(result.counts, { 'missing>passed': 1, 'missing>failed': 1, 'missing>skipped': 1 });
  assert.deepEqual(result.entries.map(({ name, baseStatus, headStatus }) => [name, baseStatus, headStatus]), [
    ['error', 'missing', 'failed'], ['pass', 'missing', 'passed'], ['skip', 'missing', 'skipped'],
  ]);
});

for (const [label, change] of [
  ['tools', { tools: [{ name: 'node', version: '23' }] }],
  ['environment', { environment: { ...report('', []).run.environment, osVersion: '7' } }],
  ['working folder', { workingDirectory: 'other' }],
]) test(`outcomes do not pair reports with different ${label}`, () => {
  const base = report('base.xml', [item('one', 'passed')]);
  const head = report('head.xml', [item('one', 'skipped')]);
  head.run = { ...head.run, ...change };
  assert.equal(compare([base], [head]).state, 'UNKNOWN');
});

test('paired reports without test cases leave outcomes unknown', () => {
  const result = compare([report('base.xml', [])], [report('head.xml', [])]);
  assert.equal(result.state, 'UNKNOWN');
  assert.match(result.reason, /paired reports.*no test cases/i);
  assert.deepEqual([result.counts, result.total, result.entries], [{}, 0, []]);
  assert.equal(compare([report('base.xml', [])], [report('head.xml', [item('new', 'passed')])]).state, 'COMPARED');
  assert.equal(compare([report('base.xml', [item('lost', 'passed')])], [report('head.xml', [])]).state, 'COMPARED');
  assert.equal(compare([report('base.xml', []), report('other-base.xml', [item('stable', 'passed')], ['other'])],
    [report('head.xml', []), report('other-head.xml', [item('stable', 'passed')], ['other'])]).state, 'COMPARED');
  assert.equal(compare([report('base.xml', [])],
    [report('head.xml', []), report('unpaired.xml', [item('unpaired', 'passed')], ['other'])]).state, 'UNKNOWN');
});
