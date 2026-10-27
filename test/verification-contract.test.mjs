import assert from 'node:assert/strict';
import { test } from 'node:test';
import { writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { validateRequest } from '../lib/verify-request.mjs';
import { categories } from '../lib/ratings.mjs';
import { compareRatings, ratingContract } from '../lib/verification-contract.mjs';
import { validateResults } from '../lib/verification-schema.mjs';
import { readRun } from '../lib/verify-context.mjs';
import { writeRun } from '../lib/verify-report.mjs';
import { project, outcome } from './oracle-fixtures.mjs';

const input = (category) => ({ category, required: true, rubric: { version: 'ratings-v0' }, inapplicable: null,
  minimumEvidence: { met: false, missing: ['No execution evidence.'] }, obligations: [], fundamental: [],
  bands: { 3: [{ id: 'si.imports-classified', met: null, evidenceIds: [] }], 4: [], 5: [] } });
const request = { changeType: 'other', allowedPaths: ['src/**'], acceptanceCriteria: [] };
const rules = { profile: { id: 'static-baseline-v0', ratingRulesVersion: 'ratings-v0' }, thresholds: { changedLines: 80 } };
const evaluation = { obligations: [], categories: Object.fromEntries(categories.map((id) => [id, input(id)])) };
const contract = (fields = {}) => ratingContract({ request, rules, evaluation, repository: 'fixture', paths: ['src/a.ts'], evaluatorDigest: 'a'.repeat(64), analysisPolicy: { config: 'fixture', roots: ['src'], analyzer: { version: '1.0.0', source: 'a'.repeat(64), node: '24', typescript: '6.0.3' } }, ...fields });
const report = () => ({ ...contract(), profileId: rules.profile.id, ratingRulesVersion: 'ratings-v0',
  ratings: Object.fromEntries(categories.map((id) => [id, { state: 'RATED', value: 3 }])) });

test('compatible reports compare four independent ordered bands without an aggregate', () => {
  const base = report(), head = report();
  head.ratings.structuralIntegrity.value = 4;
  const value = compareRatings(base, head);
  assert.equal(value.state, 'COMPARABLE');
  assert.deepEqual(value.categories.structuralIntegrity, { state: 'COMPARED', base: 3, head: 4, direction: 'UP' });
  assert.equal(value.categories.verificationCoverage.direction, 'SAME');
  assert.deepEqual(Object.keys(value.categories), categories);
  assert.deepEqual(Object.keys(value), ['state', 'reasons', 'categories']);
});

test('changed thresholds prevent category band comparison even with the same version labels', () => {
  const base = report(), head = report();
  head.rubric.thresholds.changedLines = 81;
  assert.match(compareRatings(base, head).reasons.join(' '), /rubric/i);
  assert.equal(compareRatings(base, head).state, 'INCOMPARABLE');
});

test('changed obligation scope prevents category band comparison', () => {
  const base = report(), head = report();
  head.ratingScope.paths.push('src/b.ts');
  assert.match(compareRatings(base, head).reasons.join(' '), /scope/i);
  assert.equal(compareRatings(base, head).categories.structuralIntegrity.state, 'UNKNOWN');
});

test('changed evidence policy prevents category band comparison', () => {
  const base = report(), head = report();
  head.rubric.evidencePolicy.trust = 'different';
  assert.match(compareRatings(base, head).reasons.join(' '), /polic/i);
});

test('Unassessed and missing historical rubric evidence never produce a numeric comparison', () => {
  const base = report(), head = report();
  base.ratings.behavioralConfidence = { state: 'UNASSESSED', value: null };
  assert.deepEqual(compareRatings(base, head).categories.behavioralConfidence,
    { state: 'UNKNOWN', base: null, head: 3, reason: 'Both categories need an assessed band.' });
  delete base.rubric;
  assert.equal(compareRatings(base, head).state, 'UNKNOWN');
});

test('invalid obligations, ratings and rubric definitions are refused on writes and reads', (t) => {
  const f = project(t), first = outcome(f.verify(f.request()), 3);
  const invalid = structuredClone(first.results);
  invalid.obligations[0].eligible = 'yes';
  assert.equal(validateResults(invalid).ok, false);
  assert.throws(() => writeRun(join(f.work, 'bad'), { runId: invalid.runId, results: invalid, markdown: '' }), /schema/i);
  assert.equal(existsSync(join(f.work, 'bad')), false);
  const json = first.summary.files.results;
  const badRubric = structuredClone(first.results);
  badRubric.rubric.categories.structuralIntegrity.bands['3'][0].id = 7;
  writeFileSync(json, JSON.stringify(badRubric));
  assert.throws(() => readRun(f.out, first.summary.runId), /schema/i);
  const changed = structuredClone(first.results);
  changed.ratings.structuralIntegrity.value = 9;
  assert.equal(validateResults(changed).ok, false);
});

test('changed rubric membership, versions and evaluator source prevent comparison', () => {
  const base = report(), head = report();
  head.rubric.categories.structuralIntegrity.bands['4'].push({ id: 'extra', condition: 'An extra check passes.' });
  assert.equal(compareRatings(base, head).state, 'INCOMPARABLE');
  const version = report();
  version.ratingRulesVersion = 'ratings-next';
  assert.equal(compareRatings(base, version).state, 'INCOMPARABLE');
  const source = report();
  source.rubric.evaluatorDigest = 'b'.repeat(64);
  assert.equal(compareRatings(base, source).state, 'INCOMPARABLE');
});

test('missing evaluator identity or analysis policy keeps the comparison unknown', () => {
  const base = report(), head = report();
  delete base.rubric.evaluatorDigest;
  assert.equal(compareRatings(base, head).state, 'UNKNOWN');
  const policy = report();
  policy.rubric.evidencePolicy.analysisPolicy = null;
  assert.equal(compareRatings(policy, head).state, 'UNKNOWN');
});

test('the request accepts only a safe stored baseline run ID', () => {
  const f = { ...request, requestType: 'code-map-verification-request', schemaVersion: 1, base: 'HEAD', head: 'HEAD', intent: 'Check bands.',
    profileId: 'static-baseline-v0', ratingRulesVersion: 'ratings-v0', reportInputs: [],
    execution: { enabled: false, authorization: null, budgets: { wallClockSeconds: 1, memoryMegabytes: 1, outputMegabytes: 1, concurrency: 1 } } };
  assert.equal(validateRequest({ ...f, baselineReport: 'V-1' }).ok, true);
  assert.equal(validateRequest({ ...f, baselineReport: '../elsewhere' }).ok, false);
  assert.equal(validateRequest({ ...f, baselineReport: '/tmp/report.json' }).ok, false);
  assert.equal(validateRequest({ ...f, baselineReport: 42 }).ok, false);
});

test('an empty analysis policy cannot establish category comparability', () => {
  const base = report(), head = report();
  base.rubric.evidencePolicy.analysisPolicy = {};
  head.rubric.evidencePolicy.analysisPolicy = {};
  assert.equal(compareRatings(base, head).state, 'UNKNOWN');
});

const stored = () => ({ ...report(), reportType: 'code-map-verification', schemaVersion: 1, runId: 'V-fixture',
  createdAt: '2026-10-23T12:00:00.000Z', obligations: [], readiness: { state: 'INSUFFICIENT_EVIDENCE', exitCode: 3 },
  ratings: Object.fromEntries(categories.map((id) => [id, { state: 'RATED', value: 3, label: 'Adequate', reason: 'Fixture evidence.' }])) });
const invalidRecords = [
  ['a malformed obligation', (value) => { value.obligations = [{ eligible: 'yes' }]; }],
  ['a malformed predicate definition', (value) => { value.rubric.categories.structuralIntegrity.bands['3'][0].id = 7; }],
  ['an out-of-range rating', (value) => { value.ratings.structuralIntegrity.value = 9; }],
  ['a negative completeness count', (value) => { value.ratings.structuralIntegrity.evidenceCompleteness = { required: { completed: -1, total: 1 }, optional: { completed: 0, total: 0 }, unknown: 1, skipped: 0 }; }],
  ['a comparison without assessed bands', (value) => { value.ratingComparison = { ...compareRatings(value, value), baselineRunId: 'V-base' }; value.ratingComparison.categories.structuralIntegrity.base = null; }],
  ['a contradictory comparison direction', (value) => { value.ratingComparison = { ...compareRatings(value, value), baselineRunId: 'V-base' }; value.ratingComparison.categories.structuralIntegrity.direction = 'UP'; }],
  ['an incorrect readiness exit code', (value) => { value.readiness.exitCode = 0; }],
];
for (const [name, mutate] of invalidRecords) test(`stored results reject ${name}`, () => {
  const value = stored();
  assert.equal(validateResults(value).ok, true);
  mutate(value);
  assert.equal(validateResults(value).ok, false);
});

const requestScopes = [
  ['public-change exceptions', { allowedPublicChanges: ['login'] }],
  ['nominated regression cases', { regressionTests: [{ file: 'test/login.test.ts', name: 'rejects' }] }],
  ['nominated generated cases', { generatedTests: [{ file: 'test/login.test.ts', name: 'accepts' }] }],
];
for (const [name, fields] of requestScopes) test(`changed ${name} prevent category band comparison`, () => {
  const base = report(), head = { ...report(), ...contract({ request: { ...request, ...fields } }) };
  assert.equal(compareRatings(base, head).state, 'INCOMPARABLE');
  assert.match(compareRatings(base, head).reasons.join(' '), /scope/);
});

test('authorization tool minimums remain part of the stored evidence policy', () => {
  const base = { ...report(), ...contract({ executions: [{ trust: { tool: 'node', minimum: 'isolated' } }] }) };
  const head = { ...report(), ...contract({ executions: [{ trust: { tool: 'node', minimum: 'trusted-signed' } }] }) };
  assert.equal(compareRatings(base, head).state, 'INCOMPARABLE');
  assert.deepEqual(head.rubric.evidencePolicy.toolMinimums, [{ tool: 'node', minimum: 'trusted-signed' }]);
});
