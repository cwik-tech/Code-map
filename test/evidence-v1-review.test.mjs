// Confirmed review boundaries from the proposal, with focused regression tests.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { evaluateProfile, profileReadiness } from '../lib/profiles/evidence-v1.mjs';
import { rateCategory } from '../lib/ratings.mjs';
import { context, isolated } from './evidence-v1-fixtures.mjs';
import { request, testCase, modified, compilerReport, diagnostic } from './profile-fixtures.mjs';
const check = (c, id) => evaluateProfile(c).obligations.find((x) => x.id === id).result;
test('an unchanged pre-existing case in an edited test file still confirms preservation', () => {
  const c = context({ request: request({ changeType: 'refactor' }), change: modified('src/a.ts', 'test/a.test.ts') });
  c.evidence.cases = [{ ...testCase(), origin: 'pre-existing' }];
  assert.equal(check(c, 'refactor.behavior-preserved'), 'PASS');
});
test('an unclassified potentially pre-existing case cannot be excluded from preservation', () => {
  const c = context({ request: request({ changeType: 'refactor' }), change: modified('src/a.ts', 'test/a.test.ts') });
  c.head.analysis.tests.cases.push({ path: 'test/a.test.ts', suite: 'a', name: 'second', status: 'active' });
  c.base.analysis.tests.cases.push({ path: 'test/a.test.ts', suite: 'a', name: 'second', status: 'active' });
  c.evidence.cases = [{ ...testCase(), origin: 'pre-existing' }];
  assert.equal(check(c, 'refactor.behavior-preserved'), 'UNKNOWN');
});
test('a differential crash fails refactor preservation and an empty harness never passes', () => {
  const c = context({ request: request({ changeType: 'refactor' }) });
  c.evidence.harness = [{ mode: 'differential', base: c.base.sha, inputs: 0, calls: 2, failures: 1, attestation: 'isolated', outcomes: [{ kind: 'crash' }] }];
  assert.equal(check(c, 'refactor.behavior-preserved'), 'FAIL');
  c.evidence.harness = [{ mode: 'property', calls: 0, failures: 0, outcomes: [] }];
  assert.equal(check(c, 'behavior.harness-holds'), 'UNKNOWN');
});
test('policy checks select added package versions and inspect their own install scripts', () => {
  const c = context();
  c.evidence.policy = { forbidInstallScripts: true };
  c.evidence.supply.changes = [{ change: 'added', name: 'pkg', to: '2.0.0' }];
  c.evidence.newPackages = [{ name: 'pkg', version: '2.0.0', installScript: false }];
  c.evidence.supplyFindings = [{ id: 'old-license', facts: { name: 'pkg', version: '1.0.0' } }];
  assert.equal(check(c, 'completeness.dependency-policy'), 'PASS');
  c.evidence.newPackages[0].installScript = true;
  assert.equal(check(c, 'completeness.dependency-policy'), 'FAIL');
});
test('a policy without a readable lockfile stays UNKNOWN', () => {
  const c = context();
  c.evidence.policy = { forbidInstallScripts: true };
  c.evidence.supply = { state: 'unknown', changes: [] };
  assert.equal(check(c, 'completeness.dependency-policy'), 'UNKNOWN');
});
test('a bound compiler can show a consumer compatible despite an unrelated type error', () => {
  const c = context({ compiler: { head: [compilerReport([diagnostic('unrelated.ts')])], base: [] } });
  c.evidence.api.items = [{ status: 'CHANGED', group: 'module', consumers: { items: [{ path: 'src/b.ts' }] } }];
  const evaluated = evaluateProfile(c);
  assert.equal(rateCategory(evaluated.categories.changeCompleteness).value, 5);
});

test('moved pre-existing cases match through the change rename map', () => {
  const c = context({ request: request({ changeType: 'refactor' }) });
  c.change.files.push({ status: 'R', from: 'test/a.test.ts', path: 'test/moved.test.ts' });
  c.change.paths.push('test/a.test.ts', 'test/moved.test.ts');
  c.head.analysis.tests.cases[0].path = 'test/moved.test.ts';
  c.head.analysis.files[0].tests.direct = ['test/moved.test.ts'];
  c.reports.head = [isolated([testCase('passed', 'works', 'test/moved.test.ts')])];
  c.evidence.cases = [{ ...testCase('passed', 'works', 'test/moved.test.ts'), origin: 'pre-existing' }];
  assert.equal(check(c, 'refactor.behavior-preserved'), 'PASS');
});
test('a base report of unrelated cases is not an independent test reference', () => {
  const c = context();
  c.reports.base = [isolated([testCase('passed', 'unrelated', 'test/other.test.ts')])];
  assert.equal(rateCategory(evaluateProfile(c).categories.behavioralConfidence).state, 'UNASSESSED');
});

test('an optional failed harness gives REVIEW rather than BLOCKED when required evidence is complete', () => {
  const c = context();
  c.evidence.harness = [{ mode: 'property', calls: 1, failures: 1, outcomes: [{ kind: 'property' }] }];
  const e = evaluateProfile(c), ratings = Object.fromEntries(Object.entries(e.categories).map(([id, x]) => [id, rateCategory(x)]));
  assert.equal(profileReadiness(e.obligations, ratings, c).state, 'REVIEW');
});

test('a compiler syntax error outside a consumer cannot prove that consumer compatible', () => {
  const c = context({ compiler: { head: [compilerReport([diagnostic('other.ts', 8000)])], base: [] } });
  c.evidence.api.items = [{ status: 'CHANGED', group: 'module', consumers: { items: [{ path: 'src/b.ts' }] } }];
  assert.equal(rateCategory(evaluateProfile(c).categories.changeCompleteness).value, 4);
});
