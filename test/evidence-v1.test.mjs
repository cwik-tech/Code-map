// Proposal section 5 decisions. Expected outcomes come from the proposal tables.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { evaluateProfile, profileReadiness } from '../lib/profiles/evidence-v1.mjs';
import { rateCategory, validateObligation } from '../lib/ratings.mjs';
import { context, isolated, oracle } from './evidence-v1-fixtures.mjs';
import { request, testCase, compilerReport, diagnostic } from './profile-fixtures.mjs';
const evaluate = (c) => {
  const result = evaluateProfile(c), ratings = Object.fromEntries(Object.entries(result.categories).map(([id, value]) => [id, rateCategory(value)]));
  return { ...result, ratings, checks: Object.fromEntries(result.obligations.map((x) => [x.id, x.result])), ready: profileReadiness(result.obligations, ratings, c) };
};
const evidence = (fields) => ({ ...context().evidence, ...fields });
const api = (items) => ({ state: 'COMPARABLE', complete: true, items });
const change = (fields = {}) => ({ group: 'public', status: 'CHANGED', name: 'a', path: 'src/a.ts', consumers: { total: 1, items: [{ path: 'src/b.ts' }] }, ...fields });
test('public compatibility passes clean evidence, fails consumer errors or wrong arity, and keeps inferred changes unknown', () => {
  assert.equal(evaluate(context()).checks['structure.public-interface'], 'PASS');
  const e = evidence({ api: api([change()]) });
  assert.equal(evaluate(context({ evidence: e, compiler: { head: [compilerReport([diagnostic('src/b.ts')])], base: [] } })).checks['structure.public-interface'], 'FAIL');
  assert.equal(evaluate(context({ evidence: e, compiler: { head: [], base: [] } })).checks['structure.public-interface'], 'UNKNOWN');
  assert.equal(evaluate(context({ evidence: { ...e, calls: { sites: [{ likelyBreak: true, export: { path: 'src/a.ts', name: 'a' } }], unread: [] } }, compiler: { head: [], base: [] } })).checks['structure.public-interface'], 'FAIL');
  assert.equal(evaluate(context({ evidence: evidence({ api: api([change({ status: 'UNKNOWN' })]) }) })).checks['structure.public-interface'], 'UNKNOWN');
});
test('refactor requires twenty differential inputs or all reaching pre-existing cases on matching isolated runs', () => {
  const c = context({ request: request({ changeType: 'refactor' }) });
  assert.equal(evaluate(c).checks['refactor.behavior-preserved'], 'PASS');
  assert.equal(evaluate({ ...c, reports: { head: [isolated()], base: [] } }).checks['refactor.behavior-preserved'], 'UNKNOWN');
  assert.equal(evaluate({ ...c, reports: { head: [isolated([testCase('failed')])], base: [isolated()] } }).checks['refactor.behavior-preserved'], 'FAIL');
  const differential = { mode: 'differential', inputs: 20, base: c.base.sha, outcomes: [], failures: 0, attestation: 'isolated' };
  const noBase = { ...c, reports: { head: [isolated()], base: [] }, evidence: evidence({ harness: [differential] }) };
  assert.equal(evaluate(noBase).checks['refactor.behavior-preserved'], 'PASS');
  assert.equal(evaluate({ ...noBase, evidence: evidence({ harness: [{ ...differential, inputs: 19 }] }) }).checks['refactor.behavior-preserved'], 'UNKNOWN');
  assert.equal(evaluate({ ...noBase, evidence: evidence({ harness: [{ ...differential, outcomes: [{ kind: 'difference' }], failures: 1 }] }) }).checks['refactor.behavior-preserved'], 'FAIL');
});
test('fix checks use named cases and preserve failure before unknown', () => {
  const c = context({ request: request({ changeType: 'fix', regressionTests: [{ file: 'test/a.test.ts', name: 'works' }] }), reports: { head: [isolated()], base: [isolated([testCase('failed')])] } });
  assert.equal(evaluate(c).checks['fix.reproduced'], 'PASS');
  assert.equal(evaluate(c).checks['fix.regression-check'], 'PASS');
  assert.equal(evaluate({ ...c, reports: { head: [isolated()], base: [isolated()] } }).checks['fix.reproduced'], 'FAIL');
  assert.equal(evaluate({ ...c, reports: { head: [isolated([testCase('failed')])], base: [] } }).checks['fix.regression-check'], 'FAIL');
  assert.equal(evaluate({ ...c, reports: { head: [], base: [] } }).checks['fix.reproduced'], 'UNKNOWN');
  assert.equal(evaluate({ ...c, reports: { head: [], base: [] } }).checks['fix.regression-check'], 'UNKNOWN');
});
test('criteria need a passed linked case with a current human record, and failed linked cases take priority', () => {
  const c = context({ request: request({ acceptanceCriteria: [{ id: 'AC1', text: 'Works.' }] }) });
  const linked = { ...testCase(), criteria: ['AC1'], evidenceId: 'case:head:works' };
  assert.equal(evaluate(c).checks['acceptance.AC1'], 'UNKNOWN');
  const good = { ...c, evidence: evidence({ oracles: [oracle()], cases: [linked] }) };
  assert.equal(evaluate(good).checks['acceptance.AC1'], 'PASS');
  assert.equal(evaluate({ ...good, evidence: evidence({ oracles: [oracle({ stale: true })], cases: [linked] }) }).checks['acceptance.AC1'], 'UNKNOWN');
  assert.equal(evaluate({ ...good, evidence: evidence({ oracles: [], cases: [{ ...linked, status: 'failed' }] }) }).checks['acceptance.AC1'], 'FAIL');
});
test('harness failures are optional failures and an absent harness is not applicable', () => {
  assert.equal(evaluate(context()).checks['behavior.harness-holds'], 'NOT_APPLICABLE');
  assert.equal(evaluate(context({ evidence: evidence({ harness: [{ mode: 'property', outcomes: [], failures: 0 }] }) })).checks['behavior.harness-holds'], 'PASS');
  assert.equal(evaluate(context({ evidence: evidence({ harness: [{ mode: 'property', outcomes: [{ kind: 'property' }], failures: 1 }] }) })).checks['behavior.harness-holds'], 'FAIL');
});
test('migration, documentation, stale-reference and dependency policy checks follow proposal outcomes', () => {
  const result = evaluate(context());
  assert.equal(result.checks['completeness.migrations-docs'], 'PASS');
  assert.equal(result.checks['completeness.no-stale-references'], 'PASS');
  assert.equal(result.checks['completeness.dependency-policy'], 'NOT_APPLICABLE');
  assert.equal(evaluate(context({ evidence: evidence({ schemas: { migrations: [{ state: 'MIGRATION_MISSING' }] } }) })).checks['completeness.migrations-docs'], 'FAIL');
  assert.equal(evaluate(context({ evidence: evidence({ api: api([change()]) }) })).checks['completeness.migrations-docs'], 'FAIL');
  assert.equal(evaluate(context({ evidence: evidence({ schemaUnread: true }) })).checks['completeness.migrations-docs'], 'UNKNOWN');
  assert.equal(evaluate(context({ evidence: evidence({ references: { hits: [{ path: 'config.json', place: 'json' }] } }) })).checks['completeness.no-stale-references'], 'FAIL');
  const policy = { forbidInstallScripts: true };
  assert.equal(evaluate(context({ evidence: evidence({ policy }) })).checks['completeness.dependency-policy'], 'PASS');
  assert.equal(evaluate(context({ evidence: evidence({ policy, supply: { state: 'unknown', changes: [] } }) })).checks['completeness.dependency-policy'], 'UNKNOWN');
  assert.equal(evaluate(context({ evidence: evidence({ policy, newPackages: [{ name: 'bad', version: '1', installScript: true }], supply: { state: 'compared', changes: [{ change: 'added', name: 'bad', to: '1' }] } }) })).checks['completeness.dependency-policy'], 'FAIL');
});
test('ratings reach levels three, four and five only with their cumulative evidence', () => {
  const c = context(), first = evaluate(c);
  assert.equal(first.ratings.behavioralConfidence.value, 4);
  assert.equal(first.ratings.verificationCoverage.value, 4);
  assert.equal(first.ratings.structuralIntegrity.value, 5);
  assert.equal(first.ratings.changeCompleteness.value, 5);
  const high = evaluate({ ...c, evidence: evidence({ isolatedCoverage: c.coverage, mutation: [{ score: 60, counts: { killed: 6, timeout: 0, survived: 4, noCoverage: 0 } }] }) });
  assert.equal(high.ratings.behavioralConfidence.value, 5);
  assert.equal(high.ratings.verificationCoverage.value, 5);
  assert.equal(evaluate({ ...c, reports: { head: [isolated([], { filtered: true })], base: [] } }).ratings.behavioralConfidence.value, null);
  for (const item of high.obligations) assert.equal(validateObligation(item).ok, true, item.id);
});
test('READY requires isolated test reports and category ratings of at least three', () => {
  const c = context();
  assert.equal(evaluate(c).ready.state, 'READY');
  assert.equal(evaluate({ ...c, reports: { head: [isolated([testCase()], { attestation: 'self-attested' })], base: c.reports.base } }).ready.state, 'INSUFFICIENT_EVIDENCE');
  const low = evaluate({ ...c, coverage: null });
  assert.notEqual(low.ready.state, 'READY');
});
