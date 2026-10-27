// Harness contracts and real sandbox runs use a small JavaScript project.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { loadConfig } from '../lib/project.mjs';
import { validateSpec } from '../lib/harness/spec.mjs';
import { generate, seeded, shrink } from '../lib/harness/generator.mjs';
import { stable } from '../lib/harness/normalize.mjs';
import { runHarness, harnessCommand } from '../lib/harness/run.mjs';
import { loadReports } from '../lib/verify-reports.mjs';
import { analysisInputs } from '../lib/inputs.mjs';
import { authorize, project, sandboxed } from './worker-fixtures.mjs';

const subject = { file: 'subject.mjs', export: 'subject' };
const spec = (mode, extra = {}) => ({ harnessVersion: 1, subject, mode, callTimeoutMs: 500, ...extra });
const integer = { type: 'integer', min: 1, max: 100 };
function fixture(t) {
  const f = project(t);
  f.put('subject.mjs', `export function subject(x) { return x; }
export function invariant(x, y) { return y < 0; }
export function crash() { throw new TypeError('bad'); }
export function hang() { while (true) {} }
export const machine = {};
`);
  f.git('add', '.'); f.git('commit', '-qm', 'subject');
  return f;
}
async function execute(f, value, extra = {}) {
  const config = loadConfig(f.root), authorization = authorize(f, harnessCommand);
  const result = await runHarness(f.root, config, { authorization, spec: value, store: f.store, ...extra },
    { protectedFolders: [f.root, f.store, f.home], home: f.home, graceMs: 300 });
  assert.equal(result.exitCode, 0, JSON.stringify(result.record.problems));
  return { ...result, report: JSON.parse(readFileSync(result.paths.artifact, 'utf8')) };
}

test('the spec rejects unknown fields, invalid generators, paths and mode fields', () => {
  assert.throws(() => validateSpec(spec('fuzz', { generator: integer, seed: 1, timeBudgetMs: 20, surprise: true })), /surprise/);
  assert.throws(() => validateSpec(spec('property', { generator: { type: 'integer', min: 2, max: 1 }, seed: 1, count: 2, invariant: subject })), /generator/);
  assert.throws(() => validateSpec(spec('differential', { inputs: '../inputs.json', base: 'HEAD' })), /inputs/);
  assert.throws(() => validateSpec(spec('fuzz', { generator: integer, seed: 1, timeBudgetMs: 20, count: 5 })), /count/);
});

test('stable values preserve special values, sort keys and ignore named fields recursively', () => {
  assert.deepEqual(stable({ b: 1, a: undefined }), stable({ a: undefined, b: 1 }));
  assert.notDeepEqual(stable(undefined), stable(null));
  assert.notDeepEqual(stable(NaN), stable(Infinity));
  assert.notDeepEqual(stable({ $type: 'undefined' }), stable(undefined));
  assert.deepEqual(stable({ id: 1, child: { id: 2, x: 3 } }, ['id']), stable({ child: { x: 3 } }));
  assert.equal(stable(new Date('2020-01-01')).$type, 'date');
  assert.equal(stable(new TypeError('bad')).$type, 'error');
});

test('seeded generators replay and shrinking stays inside the declared domain', () => {
  const a = seeded(12), b = seeded(12);
  assert.deepEqual(Array.from({ length: 20 }, () => generate(integer, a)), Array.from({ length: 20 }, () => generate(integer, b)));
  assert.deepEqual(shrink(integer, 8), [1, 4]);
  assert.deepEqual(shrink({ type: 'string', minLength: 1, maxLength: 4, alphabet: 'ab' }, 'abab'), ['a', 'ab']);
});

test('differential compares base and head, keeps corpus digest, normalization and isolated verify information', sandboxed, async (t) => {
  const f = fixture(t), base = f.git('rev-parse', 'HEAD');
  f.put('inputs.json', '[1,2]'); f.put('subject.mjs', 'export function subject(x) { return x + 1; }');
  f.git('add', '.'); f.git('commit', '-qm', 'change');
  const result = await execute(f, spec('differential', { base, inputs: 'inputs.json', ignoreFields: ['id'] }));
  assert.equal(result.report.failures.length, 2);
  assert.match(result.report.inputDigest, /^[a-f0-9]{64}$/);
  assert.deepEqual(result.report.normalization, { ignoreFields: ['id'] });
  const inputs = analysisInputs(f.root, loadConfig(f.root), { worktree: false, ref: 'HEAD' }, 'HEAD');
  const side = { inputs, sha: inputs.sha, analysis: {} };
  const loaded = loadReports(f.root, [{ run: result.record.runId }], { head: side, base: side }, undefined, f.store);
  assert.equal(loaded.executions[0].binding, 'BOUND');
  assert.equal(loaded.executions[0].attestation, 'isolated');
  assert.equal(loaded.executions[0].harness.mode, 'differential');
  assert.equal(loaded.reports.head.length, 0);
  assert.equal(loaded.reports.ineligible.length, 0);
});

test('property records a reproducible counterexample and its shrunk input', sandboxed, async (t) => {
  const f = fixture(t), result = await execute(f, spec('property', { generator: integer, seed: 22, count: 4, invariant: { ...subject, export: 'invariant' } }));
  assert.equal(result.report.seed, 22);
  assert.equal(result.report.count, 4);
  assert.equal(result.report.failures[0].shrunkInput, 1);
});

test('fuzz records crashes, permitted errors and synchronous hangs in finite runs', sandboxed, async (t) => {
  const f = fixture(t), common = { generator: integer, seed: 1, timeBudgetMs: 700 };
  const crash = await execute(f, spec('fuzz', { ...common, subject: { ...subject, export: 'crash' } }));
  assert.equal(crash.report.finite, true);
  assert.equal(crash.report.failures[0].kind, 'crash');
  const allowed = await execute(f, spec('fuzz', { ...common, allowedErrors: ['TypeError'], subject: { ...subject, export: 'crash' } }));
  assert.equal(allowed.report.failures.length, 0);
  const hang = await execute(f, spec('fuzz', { ...common, subject: { ...subject, export: 'hang' } }));
  assert.equal(hang.report.failures[0].kind, 'hang');
});

test('decision tables execute combinations and report mismatches', sandboxed, async (t) => {
  const f = fixture(t);
  f.put('table.json', JSON.stringify({ tableVersion: 1, name: 'price', subject, conditions: [{ name: 'x', values: [1, 2] }], rules: [{ when: {}, then: 3 }] }));
  f.git('add', '.'); f.git('commit', '-qm', 'table');
  const result = await execute(f, spec('decision-table', { table: 'table.json' }));
  assert.equal(result.report.calls.length, 2);
  assert.equal(result.report.failures.length, 2);
});

test('state models report UNKNOWN without an installed supported XState API', sandboxed, async (t) => {
  const f = fixture(t);
  f.put('model.json', JSON.stringify({ modelVersion: 1, name: 'flow', states: ['a', 'b'], initial: 'a', transitions: [{ from: 'a', event: 'GO', to: 'b' }] }));
  f.git('add', '.'); f.git('commit', '-qm', 'model');
  const result = await execute(f, spec('state-model', { subject: { ...subject, export: 'machine' }, model: 'model.json' }));
  assert.equal(result.report.calls[0].result.status, 'UNKNOWN');
  assert.match(result.report.calls[0].result.reason, /[Xx][Ss]tate/);
});

test('TypeScript without a project loader is refused with a reason', sandboxed, async (t) => {
  const f = fixture(t); f.put('subject.ts', 'export const subject = (x: number) => x;');
  f.git('add', '.'); f.git('commit', '-qm', 'typescript');
  const config = loadConfig(f.root), authorization = authorize(f, harnessCommand);
  await assert.rejects(runHarness(f.root, config, { authorization, store: f.store, spec: spec('fuzz', { subject: { file: 'subject.ts', export: 'subject' }, generator: integer, seed: 1, timeBudgetMs: 20 }) }), /TypeScript.*(tsx|loader)/);
});
