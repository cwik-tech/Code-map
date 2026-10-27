// Harness refusal paths and modeled executions retain their explicit evidence limits.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { readFileSync, symlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { runHarness, harnessCommand, harnessWork } from '../lib/harness/run.mjs';
import { harnessInformation } from '../lib/harness/report.mjs';
import { loadConfig } from '../lib/project.mjs';
import { authorize, project, sandboxed, sha256 } from './worker-fixtures.mjs';
const subject = { file: 'subject.mjs', export: 'subject' };
const spec = (extra) => ({ harnessVersion: 1, mode: 'differential', subject, base: 'HEAD', inputs: 'inputs.json', callTimeoutMs: 1000, ...extra });
function fixture(t) {
  const f = project(t);
  f.put('subject.mjs', 'export const subject = (x) => ({ value: x, id: "base" });');
  f.put('inputs.json', '[ 1, 2 ]\n');
  f.git('add', '.'); f.git('commit', '-qm', 'subject');
  return f;
}
async function execute(f, value) {
  const authorization = authorize(f, harnessCommand);
  const result = await runHarness(f.root, loadConfig(f.root), { authorization, spec: value, store: f.store }, { protectedFolders: [f.root, f.store, f.home], home: f.home });
  assert.equal(result.exitCode, 0, JSON.stringify(result.record.problems));
  return JSON.parse(readFileSync(result.paths.artifact, 'utf8'));
}

test('an authorization for other command words cannot start a harness', async (t) => {
  const f = fixture(t), authorization = authorize(f, ['node', 'subject.mjs']);
  await assert.rejects(runHarness(f.root, loadConfig(f.root), { authorization, spec: spec({}), store: f.store }), /command/);
});

test('a harness never falls back to execution without a sandbox backend', async (t) => {
  const f = fixture(t), authorization = authorize(f, harnessCommand);
  await assert.rejects(runHarness(f.root, loadConfig(f.root), { authorization, spec: spec({}), store: f.store }, { backend: null }), /refuses.*never runs/);
});

test('the CLI refuses unsupported options and a spec path outside the repository', () => {
  assert.throws(() => harnessWork('.', {}, { spec: '../outside.json', kind: 'junit' }, ['harness']), /only/);
});

test('verify refuses malformed harness outputs instead of trusting their claimed counts', () => {
  assert.match(harnessInformation('null').error, /invalid shape/);
  assert.match(harnessInformation('{').error, /valid JSON/);
  assert.match(harnessInformation(JSON.stringify({ reportType: 'code-map-harness', harnessVersion: 1, mode: 'fuzz', finite: true, executed: 1, calls: [{}], failures: [] })).error, /invalid call/);
});

test('differential ignores nominated fields and hashes the exact input file bytes', sandboxed, async (t) => {
  const f = fixture(t), base = f.git('rev-parse', 'HEAD');
  f.put('subject.mjs', 'export const subject = (x) => ({ id: "head", value: x });');
  f.git('add', '.'); f.git('commit', '-qm', 'ids');
  const report = await execute(f, spec({ base, ignoreFields: ['id'] }));
  assert.equal(report.failures.length, 0);
  assert.equal(report.inputDigest, sha256('[ 1, 2 ]\n'));
});

test('differential compares thrown class and message as visible outcomes', sandboxed, async (t) => {
  const f = fixture(t), base = f.git('rev-parse', 'HEAD');
  f.put('subject.mjs', 'export const subject = () => { throw new RangeError("changed"); };');
  f.git('add', '.'); f.git('commit', '-qm', 'error');
  const report = await execute(f, spec({ base }));
  assert.equal(report.failures[0].head.error.name, 'RangeError');
  assert.equal(report.failures[0].head.error.message, 'changed');
});

test('subject logs cannot corrupt the result JSON protocol', sandboxed, async (t) => {
  const f = fixture(t);
  f.put('subject.mjs', 'export const subject = (x) => { console.log("not json"); return x; };');
  f.git('add', '.'); f.git('commit', '-qm', 'logs');
  const report = await execute(f, spec({}));
  assert.equal(report.failures.length, 0);
  assert.equal(report.calls[0].result.output, 1);
});

const require = createRequire(import.meta.url);
let xstateModules;
try { xstateModules = dirname(dirname(require.resolve('xstate/package.json'))); } catch { /* XState is optional and absent from this checkout. */ }
test('a real installed XState machine exposes a declared transition mismatch', { skip: sandboxed.skip || (!xstateModules && 'XState is not installed. No dependency is added for this test.') }, async (t) => {
  const f = fixture(t);
  f.put('.gitignore', 'node_modules\nreports/\n');
  symlinkSync(xstateModules, join(f.root, 'node_modules'), 'dir');
  f.put('subject.mjs', `import { createMachine } from 'xstate';
export const subject = createMachine({ initial: 'a', states: { a: { on: { GO: 'a' } }, b: {} } });`);
  f.put('model.json', JSON.stringify({ modelVersion: 1, name: 'flow', initial: 'a', states: ['a', 'b'], transitions: [{ from: 'a', event: 'GO', to: 'b' }] }));
  f.git('add', '.'); f.git('commit', '-qm', 'machine');
  const report = await execute(f, { harnessVersion: 1, mode: 'state-model', subject, model: 'model.json', callTimeoutMs: 1000 });
  assert.equal(report.failures[0].kind, 'mismatch');
  assert.equal(report.calls[0].result.output, 'a');
});

test('base and head resolve relative file reads from their own snapshot roots', sandboxed, async (t) => {
  const f = fixture(t);
  f.put('subject.mjs', 'import { readFileSync } from "node:fs"; export const subject = () => JSON.parse(readFileSync("value.json", "utf8"));');
  f.put('value.json', '1'); f.git('add', '.'); f.git('commit', '-qm', 'base file');
  const base = f.git('rev-parse', 'HEAD');
  f.put('value.json', '2'); f.git('add', '.'); f.git('commit', '-qm', 'head file');
  const report = await execute(f, spec({ base }));
  assert.equal(report.failures.length, 2);
  assert.equal(report.failures[0].base.output, 1);
  assert.equal(report.failures[0].head.output, 2);
});

test('thrown subclasses retain their class name even without a custom name property', sandboxed, async (t) => {
  const f = fixture(t);
  f.put('subject.mjs', 'class CustomFailure extends Error {} export const subject = () => { throw new CustomFailure("bad"); };');
  f.git('add', '.'); f.git('commit', '-qm', 'subclass');
  const report = await execute(f, spec({}));
  assert.equal(report.calls[0].result.error.name, 'CustomFailure');
});
