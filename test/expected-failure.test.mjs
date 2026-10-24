// Expected-failure transitions need reviews bound to the current test bytes.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { scanText, compareTestFile } from '../lib/assertion-compare.mjs';
import { testChanges } from '../lib/test-changes.mjs';
import { testWeakening } from '../lib/verify-change.mjs';
import { testsNotWeakened } from '../lib/profiles/evidence-v1-checks.mjs';
import { reviewDigest, writeReviews } from '../lib/weakening-reviews.mjs';
import { project } from './worker-fixtures.mjs';
const path = 'test/case.test.ts';
const baseText = "import {test, expect} from 'vitest'; test('case', () => { expect(1).toBe(2); });";
const compare = (headText) => compareTestFile({ basePath: path, headPath: path, baseText, headText });

for (const declaration of ["test.fails('case'", "test.failing('case'", "test('case', { fails: true }", "test('case', { failing: true }"]) {
  test(`expected failure requires a review for ${declaration}`, () => {
    const header = declaration.includes('failing') ? baseText.replace('vitest', '@jest/globals') : baseText;
    const headText = header.replace("test('case'", declaration);
    assert.equal(scanText(path, headText)[0].status, 'expected-failure');
    const entries = compare(headText);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].kind, 'expected-failure');
    assert.match(entries[0].id, /^weakening:[a-f0-9]{64}$/);
    const cases = (text) => ({ tests: { cases: scanText(path, text).map((x) => ({ ...x, path })) } });
    const weakening = testWeakening(cases(baseText), cases(headText), [], {}, []);
    assert.equal(weakening.expectedFailures.length, 1);
    assert.equal(weakening.weakened.length, 0, 'v0 keeps its accepted finding checks');
  });
}
test('false expected-failure options do not weaken a test', () => {
  assert.deepEqual(compare(baseText.replace("test('case'", "test('case', { fails: false }")), []);
});
test('dynamic expected-failure options require review and retain conditional status', () => {
  const headText = baseText.replace("test('case'", "test('case', { fails: enabled }");
  assert.equal(scanText(path, headText)[0].status, 'conditional');
  assert.equal(compare(headText)[0].kind, 'expected-failure');
});
test('expected-failure review is required by v1 and becomes stale after test bytes change', (t) => {
  const f = project(t), headText = baseText.replace("test('case'", "test.fails('case'");
  f.put(path, baseText); f.git('add', '.'); f.git('commit', '-qm', 'before');
  const baseSha = f.git('rev-parse', 'HEAD');
  f.put(path, headText);
  const options = { baseSha, headSha: null, change: { files: [{ path, status: 'M' }] },
    baseAnalysis: { tests: { testFiles: [{ path, kind: 'tests' }] } }, headAnalysis: { tests: { testFiles: [{ path, kind: 'tests' }] } } };
  const previous = { result: 'PASS', rationale: 'Accepted baseline.' };
  const first = testChanges(f.root, options);
  assert.equal(first.reviews.unreviewed, 1);
  assert.equal(testsNotWeakened({ tests: first }, previous)[0], 'FAIL');
  const entry = first.reviews.entries[0];
  assert.equal(entry.digest, reviewDigest(headText));
  writeReviews(f.root, [{ id: entry.id, file: path, digest: entry.digest, reason: 'Fixture review.', reviewedBy: 'Fixture human', date: '2026-10-23' }], null);
  assert.equal(testsNotWeakened({ tests: testChanges(f.root, options) }, previous)[0], 'PASS');
  f.put(path, headText + '\n');
  assert.equal(testsNotWeakened({ tests: testChanges(f.root, options) }, previous)[0], 'FAIL');
});

test('expected failures inherit through suites and stay parked inside skipped suites', () => {
  const cases = scanText(path, "describe.fails('suite',()=>{ test('child',()=>expect(1).toBe(2)); }); describe.skip('skip',()=>{ test.fails('child',()=>expect(1).toBe(2)); });");
  assert.equal(cases[0].expectedFailure, true);
  assert.equal(cases[0].status, 'expected-failure');
  assert.equal(cases[1].status, 'skipped');
});

test('shorthand and quoted expected-failure options retain review obligations', () => {
  const shorthand = baseText.replace("test('case'", "test('case', { fails }");
  const quoted = baseText.replace("test('case'", "test('case', { 'fails': true }");
  assert.equal(scanText(path, shorthand)[0].expectedFailure, true);
  assert.equal(scanText(path, shorthand)[0].status, 'conditional');
  assert.equal(compare(shorthand)[0].kind, 'expected-failure');
  assert.equal(compare(quoted)[0].kind, 'expected-failure');
});
test('conditional suite expectations survive focused child cases', () => {
  const before = "describe('s',()=>test.only('case',()=>expect(1).toBe(2)))";
  const after = before.replace("describe('s'", "describe('s', { fails: enabled }");
  assert.equal(scanText(path, after)[0].expectedFailure, true);
  assert.equal(compareTestFile({ basePath: path, headPath: path, baseText: before, headText: after })[0].kind, 'expected-failure');
});
test('a skipped suite parks a focused child', () => {
  assert.equal(scanText(path, "describe.skip('s',()=>test.only('case',()=>expect(1).toBe(2)))")[0].status, 'skipped');
});

test('removing an existing expected-failure case retains the accepted removal check', () => {
  const base = { tests: { cases: scanText(path, baseText.replace("test('case'", "test.fails('case'")).map((x) => ({ ...x, path })) } };
  assert.equal(testWeakening(base, { tests: { cases: [] } }, [], {}, []).removed.length, 1);
});
test('existing expected-failure cases still detect removed assertions', () => {
  const before = baseText.replace("test('case'", "test.fails('case'");
  assert.equal(compareTestFile({ basePath: path, headPath: path, baseText: before,
    headText: before.replace('expect(1).toBe(2);', '') })[0].kind, 'fewer-assertions');
});
