import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validateObligation } from '../lib/ratings.mjs';
import { budgetLimits, requiredObligationsFor, validateRequest } from '../lib/verify-request.mjs';

/** A valid request; each test overrides only the fields that it is about. */
const request = (fields = {}) => ({
  requestType: 'code-map-verification-request', schemaVersion: 1, base: 'main', head: 'worktree',
  intent: 'Refactor session storage without behavior change.',
  acceptanceCriteria: [{ id: 'AC-1', text: 'Existing sessions stay valid.' }, { id: 'AC-2', text: 'Logout clears the session.' }],
  allowedPaths: ['src/auth/**', 'test/auth/**'], changeType: 'refactor', profileId: 'authentication-refactor-v1', ratingRulesVersion: 'ratings-v1',
  reportInputs: [{ artifact: 'reports/junit.xml', manifest: 'reports/junit.manifest.json' }],
  execution: { enabled: false, authorization: null, budgets: { wallClockSeconds: 600, memoryMegabytes: 2048, outputMegabytes: 64, concurrency: 2 } },
  ...fields,
});
const errorsOf = (value) => { const result = validateRequest(value); assert.equal(result.ok, false); return result.errors; };
const paths = (value) => errorsOf(value).map((error) => error.path);

test('a valid request is accepted and returned as a copy', () => {
  const value = request();
  const result = validateRequest(value);
  assert.equal(result.ok, true);
  assert.deepEqual(result.request, value);
  assert.notEqual(result.request.acceptanceCriteria, value.acceptanceCriteria);
  assert.equal(validateRequest(request({ allowedPaths: null, head: 'HEAD~1', execution: { enabled: true, authorization: 'ticket-42', budgets: budgetLimits.maximum } })).ok, true);
});

test('the request type, schema version and every required field are checked', () => {
  assert.deepEqual(paths(null), ['']);
  assert.deepEqual(paths([]), ['']);
  assert.ok(paths(request({ requestType: 'code-map-verification' })).includes('requestType'));
  assert.ok(paths(request({ schemaVersion: '1' })).includes('schemaVersion'));
  assert.ok(paths(request({ schemaVersion: 2 })).includes('schemaVersion'));
  const { intent, changeType, ...missing } = request();
  assert.deepEqual(paths(missing), ['intent', 'changeType']);
  assert.ok(paths(request({ intent: '  ' })).includes('intent'));
  assert.ok(paths(request({ changeType: 'cleanup' })).includes('changeType'));
  assert.ok(paths(request({ profileId: '' })).includes('profileId'));
  assert.ok(paths(request({ ratingRulesVersion: 'ratings v1' })).includes('ratingRulesVersion'));
});

test('unknown top-level fields are errors, and every error is returned', () => {
  assert.deepEqual(paths(request({ score: 90, weights: {} })), ['score', 'weights']);
  assert.deepEqual(paths(request({ base: '', head: '-x', changeType: 'x', extra: 1 })), ['base', 'head', 'changeType', 'extra']);
});

test('base and head selectors reject option-like, spaced, parent-traversal and control-character refs', () => {
  for (const ref of ['', '-rf', 'feature branch', 'main..topic', 'a\u0000b', 'tab\tref', 7]) {
    assert.ok(paths(request({ base: ref })).includes('base'), `base ${JSON.stringify(ref)}`);
    assert.ok(paths(request({ head: ref })).includes('head'), `head ${JSON.stringify(ref)}`);
  }
  assert.ok(paths(request({ base: 'worktree' })).includes('base'), 'the base must be a revision');
});

test('acceptance criteria need nonempty IDs and text, and unique IDs', () => {
  assert.deepEqual(paths(request({ acceptanceCriteria: [{ id: 'AC-1', text: 'a' }, { id: 'AC-1', text: 'b' }] })), ['acceptanceCriteria[1].id']);
  assert.deepEqual(paths(request({ acceptanceCriteria: [{ id: '', text: '' }] })), ['acceptanceCriteria[0].id', 'acceptanceCriteria[0].text']);
  assert.deepEqual(paths(request({ acceptanceCriteria: [{ id: 'AC-1', text: 'a', weight: 2 }] })), ['acceptanceCriteria[0].weight']);
  assert.deepEqual(paths(request({ acceptanceCriteria: 'AC-1' })), ['acceptanceCriteria']);
  assert.equal(validateRequest(request({ acceptanceCriteria: [] })).ok, true);
});

test('allowed paths and report inputs must be repository-relative and safe', () => {
  const unsafe = ['', '/etc/passwd', 'C:/Windows', 'src/../../secret', '..', 'src\\auth', 'src/\u0000x'];
  for (const path of unsafe) {
    assert.deepEqual(paths(request({ allowedPaths: [path] })), ['allowedPaths[0]'], `glob ${JSON.stringify(path)}`);
    assert.deepEqual(paths(request({ reportInputs: [{ artifact: path, manifest: 'm.json' }] })), ['reportInputs[0].artifact'], `artifact ${JSON.stringify(path)}`);
  }
  assert.deepEqual(paths(request({ allowedPaths: 'src/**' })), ['allowedPaths']);
  assert.deepEqual(paths(request({ reportInputs: [{ artifact: 'a.xml' }] })), ['reportInputs[0].manifest']);
  assert.deepEqual(paths(request({ reportInputs: [{ artifact: 'a.xml', manifest: 'm.json', run: true }] })), ['reportInputs[0].run']);
});

test('execution needs an authorization when enabled and positive bounded integer budgets', () => {
  const { budgets } = request().execution;
  assert.deepEqual(paths(request({ execution: { enabled: true, authorization: null, budgets } })), ['execution.authorization']);
  assert.deepEqual(paths(request({ execution: { enabled: 'yes', authorization: null, budgets } })), ['execution.enabled']);
  assert.deepEqual(paths(request({ execution: { enabled: false, budgets } })), ['execution.authorization']);
  assert.deepEqual(paths(request({ execution: { enabled: false, authorization: null } })), ['execution.budgets']);
  for (const [key, value] of [['wallClockSeconds', 0], ['memoryMegabytes', 1.5], ['outputMegabytes', budgetLimits.maximum.outputMegabytes + 1], ['concurrency', '2']]) {
    assert.deepEqual(paths(request({ execution: { enabled: false, authorization: null, budgets: { ...budgets, [key]: value } } })), [`execution.budgets.${key}`], key);
  }
  const { concurrency, ...partial } = budgets;
  assert.deepEqual(paths(request({ execution: { enabled: false, authorization: null, budgets: partial } })), ['execution.budgets.concurrency']);
  assert.deepEqual(paths(request({ execution: { enabled: false, authorization: null, budgets, network: true } })), ['execution.network']);
});

test('each change type adds the obligations of its profile, and every obligation is valid and open', () => {
  const ids = (fields) => requiredObligationsFor(validateRequest(request(fields)).request).map((item) => item.id);
  assert.deepEqual(ids({ changeType: 'refactor' }), ['scope.allowed-paths', 'refactor.behavior-preserved', 'acceptance.AC-1', 'acceptance.AC-2']);
  assert.deepEqual(ids({ changeType: 'fix' }), ['scope.allowed-paths', 'fix.reproduced', 'fix.regression-check', 'acceptance.AC-1', 'acceptance.AC-2']);
  assert.deepEqual(ids({ changeType: 'feature' }), ['scope.allowed-paths', 'feature.consumer-contracts', 'acceptance.AC-1', 'acceptance.AC-2']);
  assert.deepEqual(ids({ changeType: 'feature', acceptanceCriteria: [] }), ['scope.allowed-paths', 'feature.consumer-contracts', 'feature.acceptance-criteria']);
  assert.deepEqual(ids({ changeType: 'other' }), ['scope.allowed-paths', 'acceptance.AC-1', 'acceptance.AC-2']);
  for (const changeType of ['refactor', 'fix', 'feature', 'other']) {
    for (const item of requiredObligationsFor(validateRequest(request({ changeType })).request)) {
      assert.equal(validateObligation(item).ok, true, `${item.id}: ${JSON.stringify(validateObligation(item).errors)}`);
      assert.deepEqual([item.required, item.result, item.eligible], [true, 'UNKNOWN', false], item.id);
    }
  }
});

test('an acceptance criterion becomes one behavioral obligation with its text as the rationale', () => {
  const [criterion] = requiredObligationsFor(validateRequest(request({ changeType: 'other', allowedPaths: [] })).request).filter((item) => item.id.startsWith('acceptance.'));
  assert.deepEqual(criterion, { id: 'acceptance.AC-1', category: 'behavioralConfidence', required: true, blocking: false, severity: 'high',
    applicability: 'APPLICABLE', result: 'UNKNOWN', eligible: false, review: 'none', evidenceIds: [], rationale: 'Existing sessions stay valid.' });
});

test('a null scope is a required obligation of unknown applicability, not permission for every edit', () => {
  const [scope] = requiredObligationsFor(validateRequest(request({ allowedPaths: null })).request);
  assert.deepEqual([scope.id, scope.category, scope.applicability, scope.result], ['scope.declared', 'changeCompleteness', 'UNKNOWN', 'UNKNOWN']);
});

test('preservation and regression obligations block, so their failure cannot be outweighed', () => {
  const blocking = (changeType) => requiredObligationsFor(validateRequest(request({ changeType })).request).filter((item) => item.blocking).map((item) => item.id);
  assert.deepEqual(blocking('refactor'), ['refactor.behavior-preserved']);
  assert.deepEqual(blocking('fix'), ['fix.regression-check']);
  assert.deepEqual(blocking('feature'), []);
});
