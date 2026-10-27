// Bounded discovery inputs from Playwright and Mocha.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseTestList } from '../lib/adapters/test-list.mjs';

const playwright = { suites: [{ title: 'a.spec.ts', file: 'test/a.spec.ts', suites: [
  { title: 'math', specs: [{ title: 'adds', file: 'test/a.spec.ts', tests: [{ projectName: 'chromium' }] }] }], specs: [] }] };
const mocha = { tests: [{ title: 'adds', fullTitle: 'math adds', file: 'test/a.spec.ts' }], pending: [] };
const parse = (format, value, options = {}) => parseTestList(JSON.stringify(value), { format, repository: '/repo', ...options });

test('Playwright discovery retains nested titles and project case multiplicity', () => {
  const result = parse('playwright-list', playwright);
  assert.equal(result.ok, true, result.error);
  assert.deepEqual(result.report.cases, [{ file: 'test/a.spec.ts', name: 'math > adds' }]);
  assert.deepEqual(result.report.files, ['test/a.spec.ts']);
});
test('Mocha discovery retains full titles and pending cases', () => {
  const result = parse('mocha-list', { ...mocha, tests: [...mocha.tests, { title: 'waits', fullTitle: 'waits', file: '/outside/a.ts' }] });
  assert.equal(result.ok, true, result.error);
  assert.deepEqual(result.report.cases, [{ file: 'test/a.spec.ts', name: 'math adds' }]);
  assert.equal(result.report.outside, 1);
});
test('Playwright refuses malformed nested discovery', () => {
  assert.equal(parse('playwright-list', { suites: [{ specs: [null] }] }).ok, false);
  assert.equal(parse('playwright-list', { suites: [{ specs: [{ title: 'a', file: 'a.ts', tests: 'bad' }] }] }).ok, false);
});
test('Mocha refuses malformed discovery', () => {
  assert.equal(parse('mocha-list', { tests: [{ fullTitle: 1, file: 'a.ts' }] }).ok, false);
  assert.equal(parse('mocha-list', []).ok, false);
});
test('Playwright bounds bytes, cases and nested suites', () => {
  assert.match(parse('playwright-list', playwright, { maxBytes: 10 }).error, /larger/);
  assert.match(parse('playwright-list', playwright, { maxEntries: 0 }).error, /more than/);
  assert.equal(parse('playwright-list', { suites: [{ suites: [{ specs: [] }] }] }, { maxEntries: 1 }).ok, false);
});
test('Mocha bounds bytes and cases', () => {
  assert.match(parse('mocha-list', mocha, { maxBytes: 10 }).error, /larger/);
  assert.match(parse('mocha-list', mocha, { maxEntries: 0 }).error, /more than/);
});

test('Playwright nested suites retain titles even when they repeat the file field', () => {
  const result = parse('playwright-list', { suites: [{ file: 'a.ts', title: 'a.ts', suites: [
    { file: 'a.ts', title: 'math', specs: [{ file: 'a.ts', title: 'adds', tests: [{}, {}] }] }] }] });
  assert.deepEqual(result.report.cases, [{ file: 'a.ts', name: 'math > adds' }, { file: 'a.ts', name: 'math > adds' }]);
});

test('Playwright refuses title expansion beyond the discovery byte budget', () => {
  const value = { suites: [{ file: 'a.ts', suites: [{ title: 'x'.repeat(300), specs: Array.from({ length: 15 }, () => (
    { file: 'a.ts', title: 'case', tests: [{}] })) }] }] };
  assert.ok(Buffer.byteLength(JSON.stringify(value)) < 2000);
  const result = parse('playwright-list', value, { maxBytes: 2000 });
  assert.equal(result.ok, false);
  assert.match(result.error, /expanded.*2000 bytes/);
});


test('Mocha includes pending-only files and deduplicates overlapping pending cases', () => {
  const pending = { file: 'test/pending.ts', fullTitle: 'later' };
  const result = parse('mocha-list', { tests: [...mocha.tests, pending], pending: [pending] });
  assert.deepEqual(result.report.cases, [
    { file: 'test/a.spec.ts', name: 'math adds' },
    { file: 'test/pending.ts', name: 'later', status: 'skipped' }
  ]);
  assert.deepEqual(result.report.files, ['test/a.spec.ts', 'test/pending.ts']);
  assert.equal(parse('mocha-list', { tests: [], pending: [null] }).ok, false);
  assert.equal(parse('mocha-list', { tests: [], pending: {} }).ok, false);
  assert.equal(parse('mocha-list', { tests: mocha.tests, pending: [pending] }, { maxEntries: 1 }).ok, false);
});
