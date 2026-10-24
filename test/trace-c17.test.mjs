// Traceability tests for capability C17 (property-based testing) that no existing test covers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runHarness, harnessCommand } from '../lib/harness/run.mjs';
import { loadConfig } from '../lib/project.mjs';
import { authorize, project, sandboxed } from './worker-fixtures.mjs';

const subject = { file: 'subject.mjs', export: 'subject' };

test('a property run records the generator version', sandboxed, async (t) => {
  const f = project(t);
  f.put('subject.mjs', "export function subject(x) { return x; }\nexport function nonnegative(input, output) { return output >= 0; }\n");
  f.git('add', '.'); f.git('commit', '-qm', 'subject');
  const spec = { harnessVersion: 1, subject, mode: 'property', seed: 42, count: 2,
    generator: { type: 'integer', min: 0, max: 100 }, invariant: { file: 'subject.mjs', export: 'nonnegative' } };
  const result = await runHarness(f.root, loadConfig(f.root), { authorization: authorize(f, harnessCommand), spec, store: f.store },
    { protectedFolders: [f.root, f.store, f.home], home: f.home, graceMs: 300 });
  assert.equal(result.exitCode, 0, JSON.stringify(result.record.problems));
  const report = JSON.parse(readFileSync(result.paths.artifact, 'utf8'));
  assert.equal(report.generatorVersion, 'mulberry32-v1');
});

async function propertyRun(f, extra = {}) {
  const spec = { harnessVersion: 1, subject, mode: 'property', seed: 42, count: 3, callTimeoutMs: 1000,
    generator: { type: 'integer', min: 4, max: 6 }, invariant: { file: 'subject.mjs', export: 'invariant' }, ...extra };
  const result = await runHarness(f.root, loadConfig(f.root), { authorization: authorize(f, harnessCommand), spec, store: f.store },
    { protectedFolders: [f.root, f.store, f.home], home: f.home, graceMs: 300 });
  assert.equal(result.exitCode, 0, JSON.stringify(result.record.problems));
  return JSON.parse(readFileSync(result.paths.artifact, 'utf8'));
}

test('property generators honor their domain and declared invariant outcomes with exact generation limits', sandboxed, async (t) => {
  const f = project(t);
  f.put('subject.mjs', 'export const subject = x => x * 2; export const invariant = (x,y) => x >= 4 && x <= 6 && y === x * 2;');
  f.git('add', '.'); f.git('commit', '-qm', 'passing property');
  const pass = await propertyRun(f);
  assert.deepEqual(pass.failures, []);
  assert.equal(pass.executed, 3);
  assert.equal(pass.count, 3);
  assert.ok(pass.calls.every(c => Number.isInteger(c.input) && c.input >= 4 && c.input <= 6 && c.result.output === c.input * 2 && c.result.invariant === true));
  f.put('subject.mjs', 'export const subject = x => x * 2; export const invariant = (x,y) => y < 0;');
  f.git('add', '.'); f.git('commit', '-qm', 'failing property');
  const fail = await propertyRun(f);
  assert.equal(fail.failures.length, 1);
  assert.equal(fail.failures[0].kind, 'property');
  assert.equal(fail.failures[0].result.invariant, false);
  assert.equal(fail.failures[0].shrunkInput, 4);
  assert.ok(fail.failures[0].shrinkAttempts > 0 && fail.failures[0].shrinkAttempts <= 100);
  assert.equal(fail.executed, fail.failures[0].shrinkAttempts + 1);
  assert.equal(fail.seed, 42);
  assert.equal(fail.generatorVersion, 'mulberry32-v1');
  assert.equal(fail.parameters.count, 3);
  assert.equal(fail.parameters.callTimeoutMs, 1000);
});

test('property call limits terminate a synchronous hang without generating more cases', sandboxed, async (t) => {
  const f = project(t);
  f.put('subject.mjs', 'export function subject() { while (true) {} } export const invariant = () => true;');
  f.git('add', '.'); f.git('commit', '-qm', 'hanging property');
  const report = await propertyRun(f, { callTimeoutMs: 200 });
  assert.equal(report.executed, 1);
  assert.equal(report.failures[0].result.status, 'hang');
  assert.equal(report.failures[0].shrinkAttempts, 0);
  assert.ok(report.calls[0].result.durationMs < 5000);
  assert.equal(report.parameters.callTimeoutMs, 200);
});
