// Revision installs use only explicit read-only caches and never lifecycle scripts.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { newAuthorization, saveAuthorization, loadAuthorization, checkAuthorization } from '../lib/worker/authorize.mjs';
import { budgets, output, project, run, sandboxed, snapshot } from './worker-fixtures.mjs';
import { installProject } from './worker-install-fixtures.mjs';

const command = [process.execPath, '-e', `const fs = require('fs'); console.log(require('revision-dep'));
if (fs.existsSync('script-ran') || fs.existsSync('node_modules/revision-dep/script-ran')) process.exit(9);`];
function authorization(fixture, words = command, cache = fixture.cache) {
  const record = newAuthorization({ repository: fixture.root, command: words, budgets, install: 'offline', npmCache: cache });
  saveAuthorization(fixture.store, record);
  return record;
}
test('authorizations bind the offline cache and refuse an added or changed install policy', (t) => {
  const fixture = project(t), cache = join(fixture.work, 'cache'); mkdirSync(cache); fixture.cache = cache;
  const record = authorization(fixture);
  assert.deepEqual(loadAuthorization(fixture.store, record.id).install, { mode: 'offline', npmCache: cache });
  const check = (fields) => checkAuthorization(record, { repository: fixture.root, command, budgets, now: new Date(), ...fields });
  assert.doesNotThrow(() => check({ install: 'offline', npmCache: cache }));
  assert.throws(() => check({}), /install policy/);
  assert.throws(() => check({ install: 'offline', npmCache: fixture.work }), /install policy/);
  assert.throws(() => newAuthorization({ repository: fixture.root, command, budgets, install: 'online', npmCache: cache }), /offline/);
  assert.throws(() => newAuthorization({ repository: fixture.root, command, budgets, npmCache: cache }), /--install/);
});
test('base and head install their own lockfiles without changing the cache or running scripts', sandboxed, async (t) => {
  const fixture = installProject(t), auth = authorization(fixture), before = snapshot(fixture.cache);
  const base = await run(fixture, command, { authorization: auth.id, head: 'base', install: 'offline', npmCache: fixture.cache });
  const head = await run(fixture, command, { authorization: auth.id, install: 'offline', npmCache: fixture.cache });
  assert.equal(base.exitCode, 0, readFileSync(base.paths.stderr, 'utf8'));
  assert.equal(head.exitCode, 0, readFileSync(head.paths.stderr, 'utf8'));
  assert.match(output(base), /1\.0\.0/); assert.match(output(head), /2\.0\.0/);
  assert.equal(base.record.dependencies.prepared, true);
  assert.equal(base.record.dependencies.sha, fixture.git('rev-parse', 'base'));
  assert.notDeepEqual(base.record.dependencies.lockfile, head.record.dependencies.lockfile);
  assert.equal(head.record.workspace.nodeModules, 'revision-offline');
  assert.equal(head.record.exitStatus, 0);
  assert.deepEqual(snapshot(fixture.cache), before);
});
test('a cache miss retains npm output and stops before the authorized command', sandboxed, async (t) => {
  const fixture = installProject(t), cache = join(fixture.work, 'empty-cache'); mkdirSync(cache);
  const words = [process.execPath, '-e', 'console.log("COMMAND RAN")'], auth = authorization(fixture, words, cache);
  const result = await run(fixture, words, { authorization: auth.id, install: 'offline', npmCache: cache });
  assert.equal(result.exitCode, 1);
  assert.equal(result.record.dependencies.prepared, false);
  assert.equal(result.record.dependencies.install.status, 'failed');
  assert.match(result.record.problems.join(' '), /no prepared dependencies/);
  assert.match(readFileSync(result.paths.stderr, 'utf8'), /ENOTCACHED|cache mode is 'only-if-cached'/);
  assert.doesNotMatch(output(result), /COMMAND RAN/);
});
test('a default authorization cannot acquire installation rights', (t) => {
  const fixture = project(t), cache = join(fixture.work, 'cache'); mkdirSync(cache);
  const record = newAuthorization({ repository: fixture.root, command, budgets });
  assert.throws(() => checkAuthorization(record, { repository: fixture.root, command, budgets, now: new Date(), install: 'offline', npmCache: cache }), /install policy/);
});
test('cache policy refuses repository and store overlap', async (t) => {
  const fixture = project(t);
  assert.throws(() => authorization(fixture, command, fixture.root), /overlap/);
  const auth = authorization(fixture, command, fixture.work);
  await assert.rejects(run(fixture, command, { authorization: auth.id, install: 'offline', npmCache: fixture.work }), /overlap/);
});
test('the installed command cannot write the cache or read its protected sibling', sandboxed, async (t) => {
  const fixture = installProject(t), secret = join(fixture.work, 'secret');
  writeFileSync(secret, 'private sibling');
  const words = [process.execPath, '-e', `const fs = require('fs');
    try { fs.writeFileSync(${JSON.stringify(join(fixture.cache, 'planted'))}, 'bad'); process.exit(8); } catch (e) { console.log(e.code); }
    try { fs.readFileSync(${JSON.stringify(secret)}); process.exit(9); } catch (e) { console.log(e.code); }`];
  const auth = authorization(fixture, words);
  const result = await run(fixture, words, { authorization: auth.id, install: 'offline', npmCache: fixture.cache },
    { protectedFolders: [fixture.work, fixture.root] });
  assert.equal(result.exitCode, 0, readFileSync(result.paths.stderr, 'utf8'));
  assert.equal(result.record.exitStatus, 0);
  assert.match(output(result), /EPERM\nEPERM/);
});
test('credential caches stay closed even when explicitly authorized', sandboxed, async (t) => {
  const fixture = installProject(t), cache = join(fixture.home, '.ssh'), auth = authorization(fixture, command, cache);
  await assert.rejects(run(fixture, command, { authorization: auth.id, install: 'offline', npmCache: cache }), /credential/);
});
test('install output and command output share one authorized output budget', sandboxed, async (t) => {
  const fixture = installProject(t), words = [process.execPath, '-e', 'process.stdout.write("x".repeat(1024 * 1024));'];
  const auth = authorization(fixture, words);
  const result = await run(fixture, words, { authorization: auth.id, install: 'offline', npmCache: fixture.cache, budgets: { outputMegabytes: 1 } });
  assert.equal(result.record.dependencies.prepared, true);
  assert.equal(result.record.stoppedBy, 'outputMegabytes');
  assert.equal(result.record.output.keptBytes, 1024 * 1024);
  assert.equal(result.exitCode, 1);
});
