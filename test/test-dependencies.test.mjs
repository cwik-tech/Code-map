// Dependency disclosure is information, independent of ratings.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { testDependencies } from '../lib/test-dependencies.mjs';
const lock = (digest) => ({ path: 'package-lock.json', digest });
const report = (attestation = 'self-attested') => ({ artifact: 'test.xml', attestation, nodeModules: attestation === 'isolated' ? 'clone' : null });
const supply = { state: 'compared', counts: { upgraded: 1 }, changes: [{ name: 'a', change: 'upgraded', from: '1', to: '2' }], reasons: [] };
test('different lockfiles disclose supply counts and shared isolated dependencies', () => {
  const result = testDependencies({ base: [report('isolated')], head: [report('isolated')] }, lock('a'), lock('b'), supply);
  assert.equal(result.lockfilesChanged, true);
  assert.deepEqual(result.counts, supply.counts);
  assert.deepEqual(result.examples, supply.changes);
  assert.equal(result.baseUsesHeadDependencies, true);
  assert.match(result.limit, /network/);
});
test('equal lockfiles have no dependency change warning', () => {
  const result = testDependencies({ base: [report()], head: [report()] }, lock('a'), lock('a'), supply);
  assert.equal(result.lockfilesChanged, false);
  assert.equal(result.baseUsesHeadDependencies, null);
  assert.deepEqual(result.examples, []);
});
test('missing reports and unread lockfiles do not establish dependency equivalence', () => {
  const result = testDependencies({ base: [], head: [report()] }, null, lock('b'), { state: 'unknown', counts: null, changes: [], reasons: ['unread'] });
  assert.equal(result.compared, false);
  assert.equal(result.lockfilesChanged, true);
  assert.equal(result.counts, null);
});

test('isolated runs without shared modules do not claim the head dependency tree', () => {
  const base = { ...report('isolated'), nodeModules: 'none' }, head = { ...report('isolated'), nodeModules: 'snapshot' };
  assert.equal(testDependencies({ base: [base], head: [head] }, lock('a'), lock('b'), supply).baseUsesHeadDependencies, null);
});

test('a secondary root lockfile change is disclosed when the primary digest stays equal', () => {
  const result = testDependencies({ base: [report()], head: [report()] }, lock('a'), lock('a'), supply, [{ path: 'yarn.lock', status: 'M' }]);
  assert.equal(result.lockfilesChanged, true);
  assert.deepEqual(result.changedLockfiles, ['yarn.lock']);
});
