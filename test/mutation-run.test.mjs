import { machineKey, signatureStatus } from '../lib/worker/signing.mjs';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, writeFileSync } from 'node:fs';
import { mutate } from '../lib/mutation/run.mjs';
import { loadConfig } from '../lib/project.mjs';
import { authorize, project, sandboxed, snapshot } from './worker-fixtures.mjs';

test('isolated mutation records survivors without changing the repository', sandboxed, async (t) => {
  const f = project(t);
  f.put('src/sum.mjs', 'export function sum(a, b) { const unused = true; return a + b; }\n');
  f.git('add', '.'); f.git('commit', '-qm', 'head');
  const command = [process.execPath, '--test'], authorization = authorize(f, command);
  f.git('status', '--porcelain');
  const before = snapshot(f.root);
  const result = await mutate(f.root, loadConfig(f.root), { authorization, command, base: 'base', head: 'HEAD', max: 20, store: f.store });
  const report = JSON.parse(readFileSync(result.files.artifact, 'utf8'));
  assert.equal(signatureStatus(JSON.parse(readFileSync(result.files.manifest, 'utf8')), [machineKey(f.store).publicKey]).state, 'valid');
  assert.equal(report.files['src/sum.mjs'].source, readFileSync(f.root + '/src/sum.mjs', 'utf8'));
  assert.ok(report.files['src/sum.mjs'].mutants.some((m) => m.status === 'Survived'));
  // Untyped parameters prevent arithmetic mutation. A numeric literal gives a proven numeric edit.
  assert.equal(JSON.parse(readFileSync(result.files.manifest, 'utf8')).environment.policy, 'isolated');
  const record = JSON.parse(readFileSync(result.files.artifact.replace(/report.json$/, 'run.json'), 'utf8'));
  assert.equal(record.durationMs, Date.parse(record.finishedAt) - Date.parse(record.startedAt));
  assert.deepEqual(snapshot(f.root), before);
});

test('an isolated numeric mutant is killed and its bound report enters verify', sandboxed, async (t) => {
  const f = project(t);
  f.put('src/sum.mjs', 'export function sum(a, b) { return a + b + 0; }\nexport const n = 1 + 2;\n');
  f.put('test/n.test.mjs', "import { test } from 'node:test'; import assert from 'node:assert/strict'; import { n } from '../src/sum.mjs'; test('n', () => assert.equal(n, 3));");
  f.git('add', '.'); f.git('commit', '-qm', 'head');
  const command = [process.execPath, '--test', '--test-reporter=tap'], authorization = authorize(f, command);
  const result = await mutate(f.root, loadConfig(f.root), { authorization, command, base: 'base', max: 10, store: f.store });
  assert.equal(JSON.parse(readFileSync(result.files.artifact, 'utf8')).files['src/sum.mjs'].mutants[0].status, 'Killed');
  const { loadReports } = await import('../lib/verify-reports.mjs');
  const { analysisInputs } = await import('../lib/inputs.mjs');
  const inputs = analysisInputs(f.root, loadConfig(f.root), {}, 'HEAD'), side = { inputs, sha: inputs.sha, analysis: {} };
  const loaded = loadReports(f.root, [{ run: result.runId }], { head: side, base: side }, undefined, f.store);
  assert.equal(loaded.executions[0].eligible, true);
  assert.equal(loaded.executions[0].mutation.mutants[0].status, 'Killed');
  assert.equal(loaded.reports.head.length, 0);
  const cached = await mutate(f.root, loadConfig(f.root), { authorization, command, base: 'base', max: 10, store: f.store });
  assert.equal(cached.runId, result.runId);
  assert.equal(cached.cached, true);
  const { cachedMutation } = await import('../lib/mutation/cache.mjs');
  const value = JSON.parse(readFileSync(result.files.artifact, 'utf8'));
  writeFileSync(result.files.artifact, readFileSync(result.files.artifact, 'utf8') + ' ');
  assert.throws(() => cachedMutation(f.store, value.cacheKey, f.root, inputs), /stale or damaged/);
});

test('a mutation that reaches the wall-clock budget records Timeout', sandboxed, async (t) => {
  const f = project(t);
  f.put('src/sum.mjs', 'export const flag = false; export function sum(a,b) { return a+b; }\n');
  f.put('test/timeout.test.mjs', "import { test } from 'node:test'; import { flag } from '../src/sum.mjs'; test('terminates', () => { while(flag) {} });");
  f.git('add', '.'); f.git('commit', '-qm', 'head');
  const command = [process.execPath, '--test'], authorization = authorize(f, command);
  const result = await mutate(f.root, loadConfig(f.root), { authorization, command, base: 'base', max: 1, budgets: { wallClockSeconds: 2 }, store: f.store });
  assert.equal(JSON.parse(readFileSync(result.files.artifact, 'utf8')).files['src/sum.mjs'].mutants[0].status, 'Timeout');
});

test('an invalid typed mutant records CompileError instead of Killed', sandboxed, async (t) => {
  const f = project(t);
  f.put('src/flag.ts', 'export const flag: true = true;\n');
  f.git('add', '.'); f.git('commit', '-qm', 'head');
  const command = [process.execPath, '--test'], authorization = authorize(f, command);
  const result = await mutate(f.root, loadConfig(f.root), { authorization, command, base: 'base', max: 1, store: f.store });
  const report = JSON.parse(readFileSync(result.files.artifact, 'utf8'));
  assert.equal(signatureStatus(JSON.parse(readFileSync(result.files.manifest, 'utf8')), [machineKey(f.store).publicKey]).state, 'valid');
  assert.equal(report.files['src/flag.ts'].mutants[0].status, 'CompileError');
});

test('a failing unchanged baseline refuses mutation evidence', sandboxed, async (t) => {
  const f = project(t);
  f.put('test/fail.test.mjs', "import { test } from 'node:test'; import assert from 'node:assert/strict'; test('baseline', () => assert.fail('baseline failure'));");
  f.git('add', '.'); f.git('commit', '-qm', 'head');
  const command = [process.execPath, '--test'], authorization = authorize(f, command);
  await assert.rejects(mutate(f.root, loadConfig(f.root), { authorization, command, base: 'base', max: 1, store: f.store }), /baseline failed/);
});


test('a mutant collection failure retains its run and stays outside the detected score', sandboxed, async (t) => {
  const f = project(t);
  f.put('src/sum.mjs', 'export const flag = false; export function sum(a,b) { return a+b; }');
  f.put('test/sum.test.mjs', "import {test} from 'node:test'; import assert from 'node:assert/strict'; import {flag,sum} from '../src/sum.mjs'; if(flag) await import('./missing-runner-plugin.mjs'); test('sum', () => assert.equal(sum(1,2),3));");
  f.git('add', '.'); f.git('commit', '-qm', 'head');
  const command = [process.execPath, '--test', '--test-reporter=tap', 'test/sum.test.mjs'], authorization = authorize(f, command);
  const result = await mutate(f.root, loadConfig(f.root), { authorization, command, base: 'base', max: 1, store: f.store });
  const value = JSON.parse(readFileSync(result.files.artifact, 'utf8'));
  const mutant = value.files['src/sum.mjs'].mutants[0];
  assert.equal(mutant.status, 'RuntimeError');
  assert.match(mutant.statusReason, /assertion|collection|runner/i);
  assert.ok(value.runs[0].runId);
  const { parseStryker, summarizeMutation } = await import('../lib/mutation/report.mjs');
  const summary = summarizeMutation(parseStryker(JSON.stringify(value)).report, new Map([['src/sum.mjs', [1]]]));
  assert.equal(summary.score, null);
  assert.equal(summary.counts.error, 1);
});
