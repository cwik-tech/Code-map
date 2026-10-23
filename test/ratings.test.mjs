import assert from 'node:assert/strict';
import { test } from 'node:test';
import { categories, evidenceCompleteness, exitCode, invalidExitCode, labels, rateCategory, readiness, validateObligation } from '../lib/ratings.mjs';

/** A valid obligation; each test overrides only the fields that it is about. */
const obligation = (fields = {}) => ({ id: 'ob-1', category: 'structuralIntegrity', required: true, blocking: false, severity: 'medium',
  applicability: 'APPLICABLE', result: 'PASS', eligible: true, review: 'none', evidenceIds: ['ev-1'], ...fields });
const met = (id) => ({ id, met: true, evidenceIds: [`ev-${id}`] });
const unmet = (id) => ({ id, met: false, evidenceIds: [] });
const unknown = (id) => ({ id, met: null, evidenceIds: [] });
/** A category input that reaches 3/5 unless a test changes it. */
const input = (fields = {}) => ({ category: 'structuralIntegrity', required: true, rubric: { version: 'ratings-v1' }, inapplicable: null,
  obligations: [obligation()], fundamental: [unmet('f1')], minimumEvidence: { met: true, missing: [] },
  bands: { 3: [met('p3')], 4: [unmet('p4')], 5: [met('p5')] }, ...fields });

test('the four categories and the five labels are fixed', () => {
  assert.deepEqual(categories, ['structuralIntegrity', 'verificationCoverage', 'behavioralConfidence', 'changeCompleteness']);
  assert.deepEqual(labels, { 1: 'Failing', 2: 'Weak', 3: 'Adequate', 4: 'Strong', 5: 'Thorough' });
});

test('a valid obligation is accepted and returned with its core fields', () => {
  const result = validateObligation({ ...obligation(), rationale: 'Required imports resolve' });
  assert.equal(result.ok, true);
  assert.deepEqual(result.obligation, { ...obligation(), rationale: 'Required imports resolve' });
});

test('an obligation with invalid fields is rejected with every error', () => {
  const cases = [
    [null, ''],
    [obligation({ id: '' }), 'id'],
    [obligation({ category: 'speed' }), 'category'],
    [obligation({ required: 'yes' }), 'required'],
    [obligation({ blocking: 1 }), 'blocking'],
    [obligation({ severity: 'critical' }), 'severity'],
    [obligation({ applicability: 'MAYBE' }), 'applicability'],
    [obligation({ applicability: 'NOT_APPLICABLE', result: 'NOT_APPLICABLE' }), 'applicabilityReason'],
    [obligation({ result: 'GREEN' }), 'result'],
    [obligation({ result: 'NOT_APPLICABLE' }), 'result'],
    [obligation({ applicability: 'NOT_APPLICABLE', applicabilityReason: 'No API', result: 'FAIL' }), 'result'],
    [obligation({ eligible: 'true' }), 'eligible'],
    [obligation({ review: 'later' }), 'review'],
    [obligation({ evidenceIds: ['ok', ''] }), 'evidenceIds'],
    [obligation({ rationale: 7 }), 'rationale'],
  ];
  for (const [value, path] of cases) {
    const result = validateObligation(value);
    assert.equal(result.ok, false, `rejects ${path || 'a non-object'}`);
    assert.ok(result.errors.some((error) => error.path === path), `${path}: ${JSON.stringify(result.errors)}`);
  }
  const many = validateObligation(obligation({ id: '', severity: 'x', review: 'x' }));
  assert.deepEqual(many.errors.map((error) => error.path), ['id', 'severity', 'review']);
});

test('evidence completeness counts eligible PASS and FAIL, keeps unknown applicability and excludes proven not-applicable', () => {
  const list = [
    obligation({ id: 'a', result: 'PASS' }),
    obligation({ id: 'b', result: 'FAIL' }),
    obligation({ id: 'c', result: 'PASS', eligible: false }),
    obligation({ id: 'd', result: 'SKIPPED' }),
    obligation({ id: 'e', applicability: 'UNKNOWN', result: 'UNKNOWN' }),
    obligation({ id: 'f', applicability: 'NOT_APPLICABLE', applicabilityReason: 'No routes', result: 'NOT_APPLICABLE' }),
    obligation({ id: 'g', required: false, result: 'PASS' }),
    obligation({ id: 'h', required: false, result: 'UNKNOWN' }),
    obligation({ id: 'i', category: 'changeCompleteness', result: 'PASS' }),
  ];
  assert.deepEqual(evidenceCompleteness(list, 'structuralIntegrity'), {
    required: { completed: 2, total: 5 }, optional: { completed: 1, total: 2 }, unknown: 3, skipped: 1,
  });
});

test('an empty category has 0 of 0 completed, not a full score', () => {
  assert.deepEqual(evidenceCompleteness([], 'behavioralConfidence'), { required: { completed: 0, total: 0 }, optional: { completed: 0, total: 0 }, unknown: 0, skipped: 0 });
});

test('the decision tree gives each band from the predicates, with the highest fully satisfied cumulative band', () => {
  const cases = [
    ['all level-3 predicates met, a level-4 predicate unmet', input(), 3, 'Adequate'],
    ['levels 3 and 4 met, level 5 unknown', input({ bands: { 3: [met('p3')], 4: [met('p4')], 5: [unknown('p5')] } }), 4, 'Strong'],
    ['levels 3, 4 and 5 met', input({ bands: { 3: [met('p3')], 4: [met('p4')], 5: [met('p5')] } }), 5, 'Thorough'],
    ['level 5 met but level 4 unmet caps the band at 3', input({ bands: { 3: [met('p3')], 4: [unmet('p4')], 5: [met('p5')] } }), 3, 'Adequate'],
    ['a profile without level-4 predicates cannot reach 4', input({ bands: { 3: [met('p3')], 4: [], 5: [met('p5')] } }), 3, 'Adequate'],
    ['an unmet level-3 predicate', input({ bands: { 3: [met('p3'), unmet('q3')], 4: [], 5: [] } }), 2, 'Weak'],
    ['an unknown level-3 predicate', input({ bands: { 3: [unknown('p3')], 4: [], 5: [] } }), 2, 'Weak'],
    ['a required obligation that failed', input({ obligations: [obligation({ result: 'FAIL' })], bands: { 3: [met('p3')], 4: [met('p4')], 5: [] } }), 2, 'Weak'],
    ['a required obligation with unknown evidence', input({ obligations: [obligation({ result: 'PASS', eligible: false })] }), 2, 'Weak'],
  ];
  for (const [name, value, expected, label] of cases) {
    const result = rateCategory(value);
    assert.equal(result.state, 'RATED', name);
    assert.equal(result.value, expected, name);
    assert.equal(result.label, label, name);
  }
});

test('a rating records the exact predicates met, unmet and unknown, including open required obligations', () => {
  const result = rateCategory(input({ obligations: [obligation({ id: 'ob-fail', result: 'FAIL' }), obligation({ id: 'ob-open', result: 'SKIPPED' })],
    bands: { 3: [met('p3')], 4: [unknown('p4')], 5: [unmet('p5')] } }));
  assert.deepEqual(result.predicates, { met: ['p3'], unmet: ['obligation:ob-fail', 'p5'], unknown: ['obligation:ob-open', 'p4'] });
  assert.deepEqual(result.failures, []);
});

test('a verified fundamental failure gives 1/5 even without minimum evidence, and still lists the missing evidence', () => {
  const result = rateCategory(input({ fundamental: [met('f-incompatible-api')], minimumEvidence: { met: false, missing: ['resolver support'] }, rubric: { version: 'ratings-v1' } }));
  assert.deepEqual([result.state, result.value, result.label], ['RATED', 1, 'Failing']);
  assert.deepEqual(result.failures, ['f-incompatible-api']);
  assert.deepEqual(result.missingEvidence, ['resolver support']);
  const unknownFailure = rateCategory(input({ fundamental: [unknown('f-maybe')] }));
  assert.equal(unknownFailure.value, 3, 'an unverified failure is not a failure');
});

test('missing minimum evidence or a missing rubric gives Unassessed with a null value, never a low number', () => {
  const cases = [
    ['minimum evidence missing', input({ minimumEvidence: { met: false, missing: ['revision-bound runner results'] } }), ['revision-bound runner results']],
    ['no configured rubric', input({ rubric: null }), []],
    ['no level-3 predicates', input({ bands: { 3: [], 4: [], 5: [] } }), []],
  ];
  for (const [name, value, missing] of cases) {
    const result = rateCategory(value);
    assert.deepEqual([result.state, result.value, result.label], ['UNASSESSED', null, 'Unassessed'], name);
    assert.deepEqual(result.missingEvidence, missing, name);
    assert.ok(result.reason.length > 0, name);
  }
});

test('an approved disposition makes a wholly inapplicable optional category Not applicable with a reason', () => {
  const result = rateCategory(input({ category: 'behavioralConfidence', required: false, inapplicable: { approved: true, reason: 'A documentation-only change' },
    obligations: [obligation({ category: 'behavioralConfidence', required: false, applicability: 'NOT_APPLICABLE', applicabilityReason: 'Docs only', result: 'NOT_APPLICABLE' })] }));
  assert.deepEqual([result.state, result.value, result.label], ['NOT_APPLICABLE', null, 'Not applicable']);
  assert.equal(result.reason, 'A documentation-only change');
  assert.equal(result.rejectedDisposition, null);
});

test('an inapplicability disposition is rejected when it is not approved, the category is required, or applicable evidence exists', () => {
  const fail = obligation({ category: 'behavioralConfidence', required: false, result: 'FAIL' });
  const cases = [
    ['not approved', { required: false, inapplicable: { approved: false, reason: 'Docs only' }, obligations: [] }, /not approved/],
    ['no reason', { required: false, inapplicable: { approved: true, reason: '' }, obligations: [] }, /reason/],
    ['a required category', { required: true, inapplicable: { approved: true, reason: 'Docs only' }, obligations: [] }, /required/],
    ['an eligible applicable failure', { required: false, inapplicable: { approved: true, reason: 'Docs only' }, obligations: [fail], fundamental: [met('f1')] }, /failure/],
    ['an applicable obligation', { required: false, inapplicable: { approved: true, reason: 'Docs only' }, obligations: [obligation({ category: 'behavioralConfidence', required: false })] }, /applicable obligation/],
  ];
  for (const [name, fields, pattern] of cases) {
    const result = rateCategory(input({ category: 'behavioralConfidence', ...fields }));
    assert.notEqual(result.state, 'NOT_APPLICABLE', name);
    assert.match(result.rejectedDisposition, pattern, name);
  }
  assert.equal(rateCategory(input({ category: 'behavioralConfidence', required: false, inapplicable: { approved: true, reason: 'Docs only' }, obligations: [fail], fundamental: [met('f1')] })).value, 1,
    'a rejected disposition cannot hide a confirmed failure');
});

test('a rating result has no combined value, total, average or weight', () => {
  const result = rateCategory(input());
  for (const key of ['score', 'total', 'average', 'weight', 'verificationScore']) assert.equal(Object.hasOwn(result, key), false, key);
});

const rated = (value) => ({ state: 'RATED', value, label: labels[value], minimumEvidenceMet: true, rubricConfigured: true });
const assessed = { structuralIntegrity: rated(3), verificationCoverage: rated(3), behavioralConfidence: rated(3), changeCompleteness: rated(3) };
const allRequired = { requiredCategories: categories };

test('each rating result tells whether the minimum evidence is met and the rubric is configured', () => {
  const cases = [
    ['a rated category', input(), [true, true]],
    ['minimum evidence missing', input({ minimumEvidence: { met: false, missing: ['resolver support'] } }), [false, true]],
    ['no configured rubric', input({ rubric: null }), [true, false]],
    ['a rubric without level-3 predicates', input({ bands: { 3: [], 4: [], 5: [] } }), [true, false]],
    ['a fundamental failure without either', input({ fundamental: [met('f1')], rubric: null, minimumEvidence: { met: false, missing: [] } }), [false, false]],
  ];
  for (const [name, value, expected] of cases) {
    const result = rateCategory(value);
    assert.deepEqual([result.minimumEvidenceMet, result.rubricConfigured], expected, name);
  }
});

test('readiness gives INSUFFICIENT_EVIDENCE for a required category rated 1 without minimum evidence or a configured rubric', () => {
  const noEvidence = rateCategory(input({ fundamental: [met('f-unresolved-import')], minimumEvidence: { met: false, missing: ['resolver support for the affected files'] } }));
  const noRubric = rateCategory(input({ fundamental: [met('f-unresolved-import')], rubric: null }));
  assert.deepEqual([noEvidence.state, noEvidence.value, noRubric.state, noRubric.value], ['RATED', 1, 'RATED', 1]);
  for (const [name, category] of [['minimum evidence missing', noEvidence], ['no configured rubric', noRubric], ['a hand-built result without the flags', { state: 'RATED', value: 3 }]]) {
    const results = { ...assessed, structuralIntegrity: category };
    const passing = readiness([obligation()], results, allRequired);
    assert.equal(passing.state, 'INSUFFICIENT_EVIDENCE', `${name}: not READY`);
    assert.deepEqual(passing.unsupportedCategories, ['structuralIntegrity'], name);
    assert.equal(readiness([obligation({ result: 'FAIL' })], results, allRequired).state, 'INSUFFICIENT_EVIDENCE', `${name}: not REVIEW`);
    assert.equal(readiness([obligation({ blocking: true, result: 'FAIL' })], results, allRequired).state, 'BLOCKED', `${name}: BLOCKED comes first`);
  }
  assert.equal(readiness([obligation()], { ...assessed, structuralIntegrity: { state: 'RATED', value: 3 } }, { requiredCategories: ['verificationCoverage'] }).state, 'READY', 'an optional category without evidence does not gate readiness');
  assert.equal(readiness([obligation()], { ...assessed, structuralIntegrity: noEvidence }, { requiredCategories: ['verificationCoverage'] }).state, 'REVIEW', 'a verified fundamental failure stays open in an optional category too');
});

test('an approved Not-applicable disposition is rejected by a verified fundamental failure, an eligible FAIL or an applicable or unknown obligation', () => {
  const own = (fields) => obligation({ category: 'behavioralConfidence', required: false, ...fields });
  const disposed = (fields) => rateCategory(input({ category: 'behavioralConfidence', required: false, inapplicable: { approved: true, reason: 'Docs only' }, fundamental: [], ...fields }));
  const regression = disposed({ fundamental: [met('f-regression')], obligations: [] });
  assert.deepEqual([regression.state, regression.value], ['RATED', 1], 'a verified fundamental failure stays visible');
  assert.match(regression.rejectedDisposition, /fundamental failure: f-regression/);
  const cases = [
    ['an eligible FAIL of unknown applicability', [own({ id: 'ob-fail', applicability: 'UNKNOWN', result: 'FAIL' })], /eligible failure: ob-fail/],
    ['an obligation of unknown applicability', [own({ id: 'ob-open', applicability: 'UNKNOWN', result: 'UNKNOWN' })], /unknown applicability: ob-open/],
    ['an applicable obligation beside a not-applicable one', [own({ id: 'ob-na', applicability: 'NOT_APPLICABLE', applicabilityReason: 'No API', result: 'NOT_APPLICABLE' }), own({ id: 'ob-live' })], /applicable obligation: ob-live/],
  ];
  for (const [name, obligations, pattern] of cases) {
    const result = disposed({ obligations });
    assert.notEqual(result.state, 'NOT_APPLICABLE', name);
    assert.match(result.rejectedDisposition, pattern, name);
  }
});

test('a category with no applicable obligations is Unassessed unless an approved Not-applicable disposition applies', () => {
  const bands = { 3: [met('p3')], 4: [met('p4')], 5: [met('p5')] };
  const cases = [
    ['an empty required category', input({ category: 'verificationCoverage', obligations: [], bands })],
    ['obligations of another category only', input({ category: 'verificationCoverage', obligations: [obligation()], bands })],
    ['only not-applicable obligations', input({ obligations: [obligation({ applicability: 'NOT_APPLICABLE', applicabilityReason: 'No API', result: 'NOT_APPLICABLE' })], bands })],
    ['only obligations of unknown applicability', input({ obligations: [obligation({ applicability: 'UNKNOWN', result: 'UNKNOWN' })], bands })],
    ['an empty optional category without a disposition', input({ category: 'behavioralConfidence', required: false, obligations: [], bands })],
  ];
  for (const [name, value] of cases) {
    const result = rateCategory(value);
    assert.deepEqual([result.state, result.value, result.label], ['UNASSESSED', null, 'Unassessed'], name);
    assert.match(result.reason, /no applicable required obligation/, name);
  }
  const failing = rateCategory(input({ category: 'verificationCoverage', obligations: [], fundamental: [met('f-never-exercised')] }));
  assert.deepEqual([failing.state, failing.value], ['RATED', 1], 'an empty category cannot hide a verified fundamental failure');
  const empty = rateCategory(input({ category: 'verificationCoverage', obligations: [], bands }));
  assert.equal(readiness([obligation()], { ...assessed, verificationCoverage: empty }, allRequired).state, 'INSUFFICIENT_EVIDENCE');
});

test('readiness follows the precedence of blocking failure, insufficient evidence, review and ready', () => {
  const cases = [
    ['an eligible blocking failure', [obligation({ blocking: true, result: 'FAIL' }), obligation({ id: 'ob-2', result: 'UNKNOWN' })], assessed, 'BLOCKED'],
    ['a blocking failure with another category at 5/5', [obligation({ blocking: true, result: 'FAIL' })], { ...assessed, verificationCoverage: rated(5) }, 'BLOCKED'],
    ['a blocking failure with a category Unassessed', [obligation({ blocking: true, result: 'FAIL' })], { ...assessed, behavioralConfidence: { state: 'UNASSESSED', value: null } }, 'BLOCKED'],
    ['an ineligible blocking failure', [obligation({ blocking: true, result: 'FAIL', eligible: false })], assessed, 'INSUFFICIENT_EVIDENCE'],
    ['a required obligation with unknown result', [obligation({ result: 'UNKNOWN' })], assessed, 'INSUFFICIENT_EVIDENCE'],
    ['a required obligation that was skipped', [obligation({ result: 'SKIPPED' })], assessed, 'INSUFFICIENT_EVIDENCE'],
    ['a required obligation of unknown applicability', [obligation({ applicability: 'UNKNOWN' })], assessed, 'INSUFFICIENT_EVIDENCE'],
    ['a required category that is Unassessed', [obligation()], { ...assessed, behavioralConfidence: { state: 'UNASSESSED', value: null } }, 'INSUFFICIENT_EVIDENCE'],
    ['a required category with no result', [obligation()], { structuralIntegrity: rated(4) }, 'INSUFFICIENT_EVIDENCE'],
    ['a nonblocking required failure', [obligation({ result: 'FAIL' })], assessed, 'REVIEW'],
    ['an unresolved optional failure', [obligation(), obligation({ id: 'ob-2', required: false, result: 'FAIL' })], assessed, 'REVIEW'],
    ['a required review', [obligation({ review: 'required' })], assessed, 'REVIEW'],
    ['a resolved optional failure', [obligation(), obligation({ id: 'ob-2', required: false, result: 'FAIL', review: 'resolved' })], assessed, 'READY'],
    ['every required obligation passes', [obligation(), obligation({ id: 'ob-2', required: false, result: 'UNKNOWN' })], assessed, 'READY'],
    ['an approved not-applicable obligation is exempt', [obligation(), obligation({ id: 'ob-2', applicability: 'NOT_APPLICABLE', applicabilityReason: 'No API', result: 'NOT_APPLICABLE' })], assessed, 'READY'],
    ['an empty assessment', [], assessed, 'INSUFFICIENT_EVIDENCE'],
    ['only not-applicable required obligations', [obligation({ applicability: 'NOT_APPLICABLE', applicabilityReason: 'No API', result: 'NOT_APPLICABLE' })], assessed, 'INSUFFICIENT_EVIDENCE'],
  ];
  for (const [name, obligations, results, expected] of cases) assert.equal(readiness(obligations, results, allRequired).state, expected, name);
});

test('low ratings do not change readiness, because readiness comes only from obligations and review rules', () => {
  const weak = { structuralIntegrity: rated(2), verificationCoverage: rated(1), behavioralConfidence: rated(2), changeCompleteness: rated(2) };
  assert.equal(readiness([obligation()], weak, allRequired).state, 'READY');
  assert.equal(readiness([obligation()], {}, { requiredCategories: [] }).state, 'READY');
});

test('readiness names the obligations and categories behind its state', () => {
  const result = readiness([obligation({ id: 'block', blocking: true, result: 'FAIL' }), obligation({ id: 'open', result: 'UNKNOWN' }), obligation({ id: 'look', review: 'required' })],
    { ...assessed, changeCompleteness: { state: 'UNASSESSED', value: null } }, allRequired);
  assert.deepEqual(result, { state: 'BLOCKED', blocking: ['block'], insufficient: ['open'], review: ['look'], unassessedCategories: ['changeCompleteness'],
    unsupportedCategories: [], failedCategories: [], reason: 'An eligible blocking obligation failed: block.' });
});

test('exit codes map each readiness state, and an unknown state is an internal failure', () => {
  assert.deepEqual(['READY', 'REVIEW', 'BLOCKED', 'INSUFFICIENT_EVIDENCE'].map(exitCode), [0, 1, 2, 3]);
  assert.equal(invalidExitCode, 4);
  assert.equal(exitCode('MAYBE'), 4);
});

test('a category whose applicable obligations are all optional is Unassessed, because its level-3 condition would check nothing', () => {
  const result = rateCategory(input({ obligations: [obligation({ required: false, result: 'PASS' })], bands: { 3: [met('p3')], 4: [met('p4')], 5: [met('p5')] } }));
  assert.equal(result.state, 'UNASSESSED');
  assert.equal(result.value, null);
});

test('a verified fundamental failure that no obligation records still keeps readiness at REVIEW', () => {
  const failing = { ...rated(1), failures: ['fundamental-1'] };
  const passing = [obligation({ id: 'ob-1', result: 'PASS' })];
  const state = readiness(passing, { ...assessed, structuralIntegrity: failing }, allRequired);
  assert.equal(state.state, 'REVIEW');
  assert.match(state.reason, /structuralIntegrity/);
});
