// Offline installation through all public command boundaries.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { budgets, project, sandboxed } from './worker-fixtures.mjs';
import { installProject } from './worker-install-fixtures.mjs';
import { validateRequest } from '../lib/verify-request.mjs';
const cli = fileURLToPath(new URL('../bin/code-map.mjs', import.meta.url));
const words = [process.execPath, '--test', '--test-reporter=junit', '--test-reporter-destination=junit.xml'];
const command = { id: 'tests', words, kind: 'junit', artifact: 'junit.xml', sides: ['base', 'head'] };
const request = (authorization, extra = {}) => ({ requestType: 'code-map-verification-request', schemaVersion: 1,
  base: 'base', head: 'HEAD', intent: 'Use revision dependencies.', acceptanceCriteria: [], allowedPaths: null,
  changeType: 'other', profileId: 'static-baseline-v0', ratingRulesVersion: 'ratings-v0', reportInputs: [],
  execution: { enabled: true, authorization, budgets, commands: [command], ...extra } });
const code = (fixture, args) => spawnSync(process.execPath, [cli, '--store', fixture.store, ...args], {
  cwd: fixture.root, encoding: 'utf8', timeout: 30000 });
test('execution validates paired offline install options', () => {
  assert.equal(validateRequest(request('AUTH-0123456789abcdef', { install: 'offline', npmCache: '/tmp/cache' })).ok, true);
  assert.equal(validateRequest(request('AUTH-0123456789abcdef', { install: 'online', npmCache: '/tmp/cache' })).ok, false);
  assert.equal(validateRequest(request('AUTH-0123456789abcdef', { install: 'offline' })).ok, false);
  assert.equal(validateRequest(request('AUTH-0123456789abcdef', { npmCache: '/tmp/cache' })).ok, false);
});
test('authorize refuses incomplete offline options at the CLI boundary', (t) => {
  const fixture = project(t);
  const result = code(fixture, ['authorize', '--install', 'offline', '--command', 'node']);
  assert.equal(result.status, 1); assert.match(result.stderr, /--npm-cache/);
});
test('run and verify use the authorized offline cache and expose each revision preparation', sandboxed, (t) => {
  const fixture = installProject(t);
  fixture.put('test/dependency.test.mjs', `import { describe, it } from 'node:test'; import assert from 'node:assert/strict';
import dep from 'revision-dep'; describe('dependency', () => it('uses head', () => assert.equal(dep, '2.0.0')));`);
  fixture.git('add', '.'); fixture.git('commit', '-qm', 'head tests');
  const options = ['--install', 'offline', '--npm-cache', fixture.cache];
  const authorized = code(fixture, ['authorize', ...options, '--concurrency', '4', '--command', ...words]);
  assert.equal(authorized.status, 0, authorized.stderr);
  const authorization = JSON.parse(authorized.stdout).authorizationId;
  const ran = code(fixture, ['run', ...options, '--authorization', authorization, '--kind', 'junit', '--artifact', 'junit.xml', '--', ...words]);
  assert.equal(ran.status, 0, ran.stderr);
  const run = JSON.parse(readFileSync(JSON.parse(ran.stdout).files.record, 'utf8'));
  assert.equal(run.dependencies.prepared, true);
  const path = join(fixture.work, 'request.json'); writeFileSync(path, JSON.stringify(request(authorization)));
  const verified = code(fixture, ['verify', '--request', path, ...options]);
  assert.notEqual(verified.status, 4, verified.stderr);
  const summary = JSON.parse(verified.stdout), results = JSON.parse(readFileSync(summary.files.results, 'utf8'));
  assert.deepEqual(results.executionRuns.map((item) => item.status), ['completed', 'completed'], JSON.stringify(results.executionRuns));
  assert.deepEqual(results.executionRuns.map((item) => [item.side, item.dependencies.prepared]), [['base', true], ['head', true]]);
  assert.equal(results.executionRuns[0].dependencies.sha, fixture.git('rev-parse', 'base'));
  assert.notDeepEqual(results.executionRuns[0].dependencies.lockfile, results.executionRuns[1].dependencies.lockfile);
  assert.equal(results.tests.dependencies.revisionDependenciesPrepared, true);
  assert.match(readFileSync(summary.files.report, 'utf8'), /offline/);
  assert.equal(results.obligations.some((item) => item.id.includes('install')), false);
});
test('verify request fields prepare revision dependencies without CLI options', sandboxed, (t) => {
  const fixture = installProject(t), options = ['--install', 'offline', '--npm-cache', fixture.cache];
  const authorized = code(fixture, ['authorize', ...options, '--concurrency', '4', '--command', ...words]);
  assert.equal(authorized.status, 0, authorized.stderr);
  const authorization = JSON.parse(authorized.stdout).authorizationId;
  const path = join(fixture.work, 'request.json');
  writeFileSync(path, JSON.stringify(request(authorization, { install: 'offline', npmCache: fixture.cache })));
  const requested = code(fixture, ['verify', '--request', path]);
  assert.notEqual(requested.status, 4, requested.stderr);
  const results = JSON.parse(readFileSync(JSON.parse(requested.stdout).files.results, 'utf8'));
  assert.deepEqual(results.executionRuns.map((item) => item.dependencies.prepared), [true, true]);
});
test('verify refuses incomplete, disabled and context-only install options', (t) => {
  const fixture = project(t), path = join(fixture.work, 'request.json');
  const value = request(null); value.execution.enabled = false; writeFileSync(path, JSON.stringify(value));
  const disabled = code(fixture, ['verify', '--request', path, '--install', 'offline', '--npm-cache', fixture.work]);
  assert.equal(disabled.status, 4); assert.match(disabled.stderr, /enabled verification execution/);
  const incomplete = code(fixture, ['verify', '--request', path, '--install', 'offline']);
  assert.equal(incomplete.status, 4); assert.match(incomplete.stderr, /--npm-cache/);
  const context = code(fixture, ['verify', '--context', 'V-invalid', '--install', 'offline', '--npm-cache', fixture.work]);
  assert.equal(context.status, 4); assert.match(context.stderr, /enabled execution/);
});
test('verify refuses conflicting request and CLI install policies', (t) => {
  const fixture = project(t), path = join(fixture.work, 'request.json');
  writeFileSync(path, JSON.stringify(request('AUTH-0123456789abcdef', { install: 'offline', npmCache: 'cache-a' })));
  const result = code(fixture, ['verify', '--request', path, '--install', 'offline', '--npm-cache', 'cache-b']);
  assert.equal(result.status, 4); assert.match(result.stderr, /conflict/);
});
