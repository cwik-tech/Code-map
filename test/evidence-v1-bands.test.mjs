// Cumulative rating boundaries and failure sensitivity of the evidence-v1 rule set.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { context, isolated, oracle } from './evidence-v1-fixtures.mjs';
import { evaluateProfile, profileReadiness } from '../lib/profiles/evidence-v1.mjs';
import { rateCategory } from '../lib/ratings.mjs';
import { request, testCase, compilerReport, diagnostic } from './profile-fixtures.mjs';
import { supplyPolicy } from '../lib/supply/policy.mjs';
const rate = (c) => {
  const e = evaluateProfile(c), ratings = Object.fromEntries(Object.entries(e.categories).map(([id, x]) => [id, rateCategory(x)]));
  return { ...e, ratings, readiness: profileReadiness(e.obligations, ratings, c) };
};
const band = (c, name) => rate(c).ratings[name].value;
test('behavioral levels one through five need the proposal evidence and cumulative bands', () => {
  const c = context();
  assert.equal(band({ ...c, reports: { head: [isolated([testCase('failed')])], base: [] } }, 'behavioralConfidence'), 1);
  assert.equal(band({ ...c, request: request({ acceptanceCriteria: [{ id: 'AC1', text: 'Works.' }] }) }, 'behavioralConfidence'), 2);
  assert.equal(band({ ...c, reports: { ...c.reports, head: [isolated([testCase()], { filtered: true })] } }, 'behavioralConfidence'), 3);
  assert.equal(band(c, 'behavioralConfidence'), 4);
  for (const [score, killed, survived, expected] of [[60, 6, 4, 5], [59, 6, 4, 4], [100, 9, 0, 4]]) {
    assert.equal(band({ ...c, evidence: { ...c.evidence, mutation: [{ score, counts: { killed, survived, timeout: 0, noCoverage: 0 } }] } }, 'behavioralConfidence'), expected);
  }
});
test('isolated statement coverage needs ninety percent, all functions and complete measurements for level five', () => {
  const c = context();
  assert.equal(band({ ...c, coverage: { ...c.coverage, changedLines: { covered: 7, total: 10 } } }, 'verificationCoverage'), 2);
  assert.equal(band({ ...c, coverage: { ...c.coverage, changedBranches: { covered: 6, total: 10 } } }, 'verificationCoverage'), 3);
  assert.equal(band(c, 'verificationCoverage'), 4);
  for (const [statements, functions, expected] of [[9, 1, 5], [8, 1, 4], [9, 0, 4]]) {
    const isolatedCoverage = { ...c.coverage, changedStatements: { covered: statements, total: 10 }, changedFunctions: { covered: functions, total: 1 } };
    assert.equal(band({ ...c, evidence: { ...c.evidence, isolatedCoverage } }, 'verificationCoverage'), expected);
  }
  assert.equal(band({ ...c, evidence: { ...c.evidence, isolatedCoverage: { ...c.coverage, unmeasuredBy: { statements: ['src/a.ts'], functions: [] } } } }, 'verificationCoverage'), 4);
});
test('structural five needs a globally clean compiler and known public comparisons', () => {
  const c = context();
  assert.equal(band(c, 'structuralIntegrity'), 5);
  assert.equal(band({ ...c, compiler: { head: [compilerReport([diagnostic('other.ts')])], base: [] } }, 'structuralIntegrity'), 4);
  assert.equal(band({ ...c, compiler: { head: [], base: [] }, reports: { head: [], base: [] } }, 'structuralIntegrity'), 3);
});
test('completeness four needs documents and stale references, while five needs every consumer updated or compiled', () => {
  const c = context(), api = { state: 'COMPARABLE', complete: true, items: [{ group: 'module', status: 'CHANGED', consumers: { items: [{ path: 'src/b.ts' }] } }] };
  assert.equal(band(c, 'changeCompleteness'), 5);
  assert.equal(band({ ...c, compiler: { head: [], base: [] }, evidence: { ...c.evidence, api } }, 'changeCompleteness'), 4);
  assert.equal(band({ ...c, evidence: { ...c.evidence, schemaUnread: true } }, 'changeCompleteness'), 3);
});
test('an oracle only supplies independent evidence when its exact case ran in an isolated head report', () => {
  const c = context(), withoutBase = { ...c, reports: { head: c.reports.head, base: [] } };
  assert.equal(band(withoutBase, 'behavioralConfidence'), null);
  assert.equal(band({ ...withoutBase, evidence: { ...c.evidence, oracles: [oracle()] } }, 'behavioralConfidence'), 4);
  assert.equal(band({ ...withoutBase, evidence: { ...c.evidence, oracles: [oracle({ name: 'another case' })] } }, 'behavioralConfidence'), null);
  assert.equal(rate({ ...c, reports: { head: [isolated([testCase('failed')], { attestation: 'self-attested' })], base: [] } }).readiness.state, 'BLOCKED');
});
test('install-script policy is explicit, boolean and does not alter the absent policy shape', () => {
  assert.equal(supplyPolicy(undefined), null);
  assert.deepEqual(supplyPolicy({ deniedLicenses: [] }), { deniedLicenses: [], allowedLicenses: null, allowedHosts: null });
  assert.equal(supplyPolicy({ forbidInstallScripts: true }).forbidInstallScripts, true);
  assert.throws(() => supplyPolicy({ forbidInstallScripts: 'true' }), /true or false/);
});
