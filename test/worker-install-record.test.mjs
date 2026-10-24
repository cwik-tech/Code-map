// Stored dependency metadata stays validated and backward compatible.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dependencyRecordProblem } from '../lib/worker/install.mjs';
const sha = 'a'.repeat(40);
const prepared = () => ({ sha, lockfile: { path: 'package-lock.json', digest: 'b'.repeat(64) }, mode: 'revision-offline', prepared: true,
  install: { policy: { mode: 'offline', npmCache: '/tmp/cache' }, command: ['npm', 'ci'], status: 'prepared', exitStatus: 0 } });
test('legacy and valid preparation records remain readable', () => {
  assert.equal(dependencyRecordProblem(undefined, sha), null);
  assert.equal(dependencyRecordProblem(prepared(), sha), null);
  assert.equal(dependencyRecordProblem({ sha, lockfile: null, mode: 'none', prepared: false, install: null }, sha), null);
});
const invalid = {
  'another revision': () => ({ ...prepared(), sha: 'c'.repeat(40) }),
  'an invalid revision digest': () => ({ ...prepared(), sha: 'bad' }),
  'an unknown module mode': () => ({ ...prepared(), mode: 'external' }),
  'a nonboolean preparation flag': () => ({ ...prepared(), prepared: 'true' }),
  'a missing lockfile field': () => ({ ...prepared(), lockfile: undefined }),
  'an unsafe lockfile path': () => ({ ...prepared(), lockfile: { path: '../lock', digest: 'b'.repeat(64) } }),
  'an invalid lockfile digest': () => ({ ...prepared(), lockfile: { path: 'package-lock.json', digest: 'bad' } }),
  'an absent install result': () => ({ ...prepared(), install: null }),
  'a missing install policy': () => ({ ...prepared(), install: { ...prepared().install, policy: undefined } }),
  'an online install policy': () => ({ ...prepared(), install: { ...prepared().install, policy: { mode: 'online', npmCache: '/tmp/cache' } } }),
  'invalid install command words': () => ({ ...prepared(), install: { ...prepared().install, command: [] } }),
  'an unknown install status': () => ({ ...prepared(), install: { ...prepared().install, status: 'done' } }),
  'a nonnumeric install exit status': () => ({ ...prepared(), install: { ...prepared().install, exitStatus: '0' } }),
  'a negative install exit status': () => ({ ...prepared(), install: { ...prepared().install, exitStatus: -1 } }),
  'a contradictory preparation flag': () => ({ ...prepared(), prepared: false }),
  'a prepared install with a failure exit': () => ({ ...prepared(), install: { ...prepared().install, exitStatus: 1 } }),
};
for (const [name, factory] of Object.entries(invalid)) {
  test(`stored dependency records refuse ${name}`, () => assert.match(dependencyRecordProblem(factory(), sha), /dependency/));
}
