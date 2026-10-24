import assert from 'node:assert/strict';
import { test } from 'node:test';
import { evaluate, modified, request } from './profile-fixtures.mjs';

test('declared write paths compare edits and explain how to resolve an out-of-scope change', () => {
  const change = modified('src/a.ts', 'scripts/build.ts');
  const scoped = evaluate({ change, request: request({ allowedPaths: ['src/**'] }) }).byId['scope.allowed-paths'];
  assert.equal(scoped.result, 'FAIL');
  assert.deepEqual(scoped.evidenceIds, ['path:scripts/build.ts']);
  assert.match(scoped.rationale, /scripts\/build.ts/);
  assert.equal(scoped.nextAction, 'Remove the changes outside the allowed paths, or add their paths to allowedPaths in the request.');
  assert.equal(evaluate({ change, request: request({ allowedPaths: ['src/**', 'scripts/**'] }) }).byId['scope.allowed-paths'].result, 'PASS');
  const unknown = evaluate({ change, request: request({ allowedPaths: null }) }).byId['scope.declared'];
  assert.deepEqual([unknown.applicability, unknown.result], ['UNKNOWN', 'UNKNOWN']);
});
