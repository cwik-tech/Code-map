// Review regressions for canonical policy identity and dependency records.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { newAuthorization, checkAuthorization, saveAuthorization } from '../lib/worker/authorize.mjs';
import { loadRun } from '../lib/worker/runs.mjs';
import { testDependencies } from '../lib/test-dependencies.mjs';
import { budgets, project, run, sandboxed, output } from './worker-fixtures.mjs';
import { installProject } from './worker-install-fixtures.mjs';
const words = [process.execPath, '-e', '0'];
function authorization(fixture, command) {
  const record = newAuthorization({ repository: fixture.root, command, budgets, install: 'offline', npmCache: fixture.cache });
  saveAuthorization(fixture.store, record);
  return record.id;
}
test('authorization policy identity ignores JSON field order', (t) => {
  const fixture = project(t), cache = join(fixture.work, 'cache'); mkdirSync(cache);
  const record = newAuthorization({ repository: fixture.root, command: words, budgets, install: 'offline', npmCache: cache });
  const reordered = { ...record, install: { npmCache: cache, mode: 'offline' } };
  assert.doesNotThrow(() => checkAuthorization(reordered, { repository: fixture.root, command: words, budgets,
    now: new Date(), install: 'offline', npmCache: cache }));
});
test('repository aliases cannot bypass cache overlap refusal', (t) => {
  const fixture = project(t), alias = join(fixture.work, 'repository-alias'); symlinkSync(fixture.root, alias);
  assert.throws(() => newAuthorization({ repository: alias, command: words, budgets, install: 'offline', npmCache: fixture.root }), /overlap/);
});
test('an offline module label alone does not establish prepared revision dependencies', () => {
  const report = { attestation: 'isolated', nodeModules: 'revision-offline' };
  const result = testDependencies({ base: [report], head: [report] }, null, null, { state: 'unknown', counts: null, changes: [], reasons: [] });
  assert.equal(result.revisionDependenciesPrepared, false);
});
test('npm shrinkwrap precedence records the lockfile actually used by the revision', sandboxed, async (t) => {
  const fixture = installProject(t), lock = fixture.git('show', 'base:package-lock.json');
  fixture.put('npm-shrinkwrap.json', lock);
  const manifest = JSON.parse(readFileSync(join(fixture.root, 'package.json'), 'utf8'));
  manifest.dependencies['revision-dep'] = '1.0.0'; fixture.put('package.json', JSON.stringify(manifest));
  fixture.git('add', '.'); fixture.git('commit', '-qm', 'shrinkwrap overrides package lock');
  const command = [process.execPath, '-e', 'console.log(require("revision-dep"))'];
  const result = await run(fixture, command, { authorization: authorization(fixture, command), install: 'offline', npmCache: fixture.cache });
  assert.equal(result.record.exitStatus, 0, readFileSync(result.paths.stderr, 'utf8'));
  assert.match(output(result), /1\.0\.0/);
  assert.equal(result.record.dependencies.lockfile.path, 'npm-shrinkwrap.json');
});
test('stored run readers refuse malformed dependency preparation records', sandboxed, async (t) => {
  const fixture = installProject(t), command = [process.execPath, '-e', 'require("fs").writeFileSync("junit.xml", "<testsuites/>")'];
  const result = await run(fixture, command, { authorization: authorization(fixture, command), install: 'offline', npmCache: fixture.cache,
    kind: 'junit', artifact: 'junit.xml' });
  assert.equal(result.exitCode, 0, readFileSync(result.paths.stderr, 'utf8'));
  writeFileSync(result.paths.record, JSON.stringify({ ...result.record, dependencies: 'unvalidated' }));
  assert.throws(() => loadRun(fixture.store, result.record.runId, fixture.root), /dependenc/);
});
