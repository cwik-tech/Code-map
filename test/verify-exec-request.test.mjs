// Strict execution and copied-test request boundaries.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validateRequest } from '../lib/verify-request.mjs';
const command = { id: 'tests', words: ['node', '--test'], kind: 'junit', artifact: 'junit.xml', sides: ['base', 'head'] };
const request = (fields = {}) => ({ requestType: 'code-map-verification-request', schemaVersion: 1, base: 'main', head: 'HEAD', intent: 'Fix.',
  acceptanceCriteria: [], allowedPaths: null, changeType: 'fix', profileId: 'static-baseline-v0', ratingRulesVersion: 'ratings-v0', reportInputs: [],
  execution: { enabled: true, authorization: 'AUTH-0123456789abcdef', commands: [command], budgets: { wallClockSeconds: 60, memoryMegabytes: 512, outputMegabytes: 8, concurrency: 1 } }, ...fields });
test('execution commands and test declarations accept only known safe fields', () => {
  assert.equal(validateRequest(request({ regressionTests: [{ file: 'test/x.test.mjs', name: 'bug' }], generatedTests: [{ file: 'test/g.test.mjs' }] })).ok, true);
});
for (const [name, patch] of Object.entries({ words: { words: [] }, shell: { shell: true }, sides: { sides: ['head', 'head'] },
  side: { sides: ['other'] }, kind: { kind: 'sh' }, traversal: { artifact: '../report.xml' }, id: { id: '' } })) {
  test(`execution refuses invalid ${name}`, () => {
    const value = request(); value.execution.commands = [{ ...command, ...patch }];
    assert.equal(validateRequest(value).ok, false);
  });
}
test('execution requires an authorization ID and nonempty commands', () => {
  const value = request(); value.execution.commands = []; assert.equal(validateRequest(value).ok, false);
  value.execution.commands = [command]; value.execution.authorization = 'ticket'; assert.equal(validateRequest(value).ok, false);
});
for (const entry of [{ file: '../x' }, { file: '/x' }, { file: '.git/config' }, { file: 'node_modules/x' }, { file: 'x', extra: true }, { file: 'x', name: '' }]) {
  test(`test declarations refuse ${JSON.stringify(entry)}`, () => assert.equal(validateRequest(request({ regressionTests: [entry] })).ok, false));
}

test('generated mutation templates and per-file authorizations are validated', () => {
  const value = request({ generatedTests: [{ file: 'test/g.test.mjs', mutationAuthorization: 'AUTH-0123456789abcdef' }] });
  value.execution.commands = [{ ...command, generatedTestWords: ['node', '--test', '{testFile}'] }];
  assert.equal(validateRequest(value).ok, true);
  value.execution.commands[0].generatedTestWords = ['node', '--test'];
  assert.equal(validateRequest(value).ok, false);
  value.execution.commands[0].generatedTestWords = ['node', '--test', '{testFile}'];
  value.generatedTests[0].mutationAuthorization = 'invalid';
  assert.equal(validateRequest(value).ok, false);
});

test('impact selection requires safe baseline paths and one whole-word selector', () => {
  const value = request();
  value.execution.commands = [{ ...command, words: ['node', '--test', '{testFiles}'], baselineSuite: ['test/base.test.mjs'] }];
  assert.equal(validateRequest(value).ok, true);
  value.execution.commands[0].baselineSuite = ['../escape'];
  assert.equal(validateRequest(value).ok, false);
  value.execution.commands[0].baselineSuite = [];
  value.execution.commands[0].words = ['node', '--test'];
  assert.equal(validateRequest(value).ok, false);
});
