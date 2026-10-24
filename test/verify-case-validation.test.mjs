// Pure comparisons preserve case names, suites and duplicate positions.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compareTestCases } from '../lib/verify-test-validation.mjs';
const item = (status, fields = {}) => ({ file: 'test/bug.mjs', suite: 'bug', name: 'rejects', status, ...fields });
test('a matching failed case and head pass confirm failure sensitivity', () => {
  const result = compareTestCases([item('failed')], [item('passed')]);
  assert.equal(result.sameCases, true);
  assert.deepEqual(result.cases.map((entry) => [entry.base, entry.head, entry.confirmed]), [['failed', 'passed', true]]);
});
test('different suites and missing cases cannot confirm the same test', () => {
  const result = compareTestCases([item('failed')], [item('passed', { suite: 'other' })]);
  assert.equal(result.sameCases, false);
  assert.deepEqual(result.cases.map((entry) => entry.confirmed), [false, false]);
});
test('duplicate names keep their individual positions and skipped outcomes', () => {
  const result = compareTestCases([item('passed'), item('failed')], [item('passed'), item('skipped')]);
  assert.equal(result.sameCases, true);
  assert.deepEqual(result.cases.map((entry) => [entry.position, entry.base, entry.head, entry.confirmed]), [[0, 'passed', 'passed', false], [1, 'failed', 'skipped', false]]);
});
