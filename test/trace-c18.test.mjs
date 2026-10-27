import assert from 'node:assert/strict';
import { test } from 'node:test';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { validateSpec } from '../lib/harness/spec.mjs';
import { harnessInformation } from '../lib/harness/report.mjs';
import { stable } from '../lib/harness/normalize.mjs';
import { runHarness, harnessCommand } from '../lib/harness/run.mjs';
import { loadConfig } from '../lib/project.mjs';
import { authorize, project, sandboxed } from './worker-fixtures.mjs';
const subject = { file: 'subject.mjs', export: 'subject' };
async function execute(f, spec) {
  const result = await runHarness(f.root, loadConfig(f.root), { authorization: authorize(f, harnessCommand),
    spec: { harnessVersion: 1, subject, callTimeoutMs: 1000, ...spec }, store: f.store },
    { protectedFolders: [f.root, f.store, f.home], home: f.home, graceMs: 300 });
  assert.equal(result.exitCode, 0, JSON.stringify(result.record.problems));
  return JSON.parse(readFileSync(result.paths.artifact, 'utf8'));
}

const fuzz = { mode: 'fuzz', seed: 1, generator: { type: 'string', minLength: 1, maxLength: 1, alphabet: '1' }, timeBudgetMs: 1000 };

test('fuzz enforces its remaining time budget on a hanging call and records the exhausted budget', sandboxed, async (t) => {
  const f = project(t);
  f.put('subject.mjs', 'export function subject() { while (true) {} }');
  f.git('add', '.'); f.git('commit', '-qm', 'hanging fuzz');
  const report = await execute(f, { ...fuzz, timeBudgetMs: 200, callTimeoutMs: 30000 });
  assert.equal(report.timeBudgetMs, 200);
  assert.equal(report.budgetExhausted, true);
  assert.equal(report.executed, 1);
  assert.equal(report.calls[0].result.status, 'hang');
  assert.ok(report.durationMs >= 190 && report.durationMs < 5000, String(report.durationMs));
  assert.deepEqual(report.failures, [], 'a call stopped by the remaining run budget is not a proven subject hang');
});

test('fuzz denies protected reads network access and child process writes outside its workspace', sandboxed, async (t) => {
  const f = project(t), marker = join(f.home, 'escape.txt');
  writeFileSync(marker, 'unchanged');
  f.put('subject.mjs', `import { readFileSync } from 'node:fs'; import { execFileSync } from 'node:child_process'; import { connect } from 'node:net';
export async function subject() {
  let read, child;
  try { readFileSync(${JSON.stringify(f.home + '/.ssh/id_rsa')}); read = 'allowed'; } catch(e) { read = e.code; }
  try { execFileSync(process.execPath, ['-e', ${JSON.stringify("require('node:fs').writeFileSync(" + JSON.stringify(marker) + ", 'escaped')")}]); child = 'allowed'; } catch(e) { child = 'denied'; }
  const network = await new Promise(resolve => { const s = connect({host:'127.0.0.1',port:1}); s.on('error', e => resolve(e.code)); s.on('connect', () => { s.destroy(); resolve('allowed'); }); });
  return {read, child, network};
}`);
  f.git('add', '.'); f.git('commit', '-qm', 'fuzz escape probes');
  const report = await execute(f, { ...fuzz, timeBudgetMs: 1500 });
  assert.deepEqual(report.calls[0].result.output, stable({ read: 'EPERM', child: 'denied', network: 'EPERM' }));
  assert.equal(readFileSync(marker, 'utf8'), 'unchanged');
  assert.equal(existsSync(join(f.root, '.code-map-harness')), false);
});

test('fuzz invokes a configured parser API with generated string inputs and measures its executions', sandboxed, async (t) => {
  const f = project(t);
  f.put('subject.mjs', 'export const subject = input => JSON.parse(input);');
  f.git('add', '.'); f.git('commit', '-qm', 'parser fuzz');
  const report = await execute(f, fuzz);
  assert.deepEqual(report.subject, subject);
  assert.ok(report.executed > 0);
  assert.equal(report.calls[0].input, '1');
  assert.equal(report.calls[0].result.output, 1);
  assert.equal(report.calls[0].result.status, 'returned');
  assert.ok(report.calls[0].result.coverage.blocks.length > 0);
});

test('fuzz accepts an initial corpus for its typed entrypoint harness', sandboxed, async (t) => {
  const f = project(t);
  f.put('subject.mjs', 'export const subject = x => JSON.parse(x);');
  f.git('add', '.'); f.git('commit', '-qm', 'initial corpus');
  const report = await execute(f, { ...fuzz, generator: { ...fuzz.generator, maxLength: 2, alphabet: '124' }, corpus: ['42', '12'] });
  assert.equal(report.calls[0].input, '42');
  assert.equal(report.calls[0].result.output, 42);
  assert.equal(report.calls[0].source, 'corpus');
  assert.equal(report.calls[1].input, '12');
  assert.equal(report.calls[1].source, 'corpus');
  assert.equal(report.calls[2].source, 'generated');
  assert.equal(harnessInformation(JSON.stringify(report)).error, undefined);
});

test('fuzz records declared invariant failures for corpus inputs', sandboxed, async (t) => {
  const f = project(t);
  f.put('subject.mjs', 'export const subject = x => JSON.parse(x); export const invariant = (x,y) => y < 0;');
  f.git('add', '.'); f.git('commit', '-qm', 'fuzz invariant');
  const report = await execute(f, { ...fuzz, corpus: ['1'], invariant: { ...subject, export: 'invariant' } });
  assert.equal(report.failures[0].kind, 'invariant');
  assert.equal(report.failures[0].input, '1');
  assert.equal(report.failures[0].result.invariant, false);
  assert.equal(report.calls[0].source, 'corpus');
  assert.equal(report.calls[1].source, 'generated');
  assert.equal(report.calls[1].result.invariant, false);
  assert.equal(report.failures[1].kind, 'invariant');
  assert.equal(harnessInformation(JSON.stringify(report)).error, undefined);
});

const typed = { type: 'object', properties: { n: { type: 'integer', min: 0, max: 2 }, flags: { type: 'array', minLength: 1, maxLength: 2, items: { type: 'boolean' } } } };
const spec = (extra) => ({ harnessVersion: 1, subject, ...fuzz, ...extra });
test('fuzz validates nested corpus values and all corpus limits before execution', () => {
  assert.equal(validateSpec(spec({ generator: typed, corpus: [{ n: 1, flags: [true] }] })).corpus.length, 1);
  assert.deepEqual(validateSpec(spec({ corpus: [] })).corpus, []);
  assert.equal(validateSpec(spec({ corpus: Array(100).fill('1') })).corpus.length, 100);
  assert.throws(() => validateSpec(spec({ corpus: Array(101).fill('1') })), /corpus/);
  assert.throws(() => validateSpec(spec({ corpus: '1' })), /corpus/);
  assert.throws(() => validateSpec(spec({ corpus: ['2'] })), /corpus/);
  assert.throws(() => validateSpec(spec({ corpus: ['11'] })), /corpus/);
  assert.throws(() => validateSpec(spec({ corpus: [1] })), /corpus/);
  assert.throws(() => validateSpec(spec({ corpus: Array(1) })), /corpus/);
  assert.throws(() => validateSpec(spec({ generator: typed, corpus: [{ n: 1, flags: Array(1) }] })), /corpus/);
  assert.throws(() => validateSpec(spec({ generator: typed, corpus: [{ n: 3, flags: [true] }] })), /corpus/);
  assert.throws(() => validateSpec(spec({ generator: typed, corpus: [{ n: 1, flags: [] }] })), /corpus/);
  assert.throws(() => validateSpec(spec({ generator: typed, corpus: [{ n: 1, flags: ['true'] }] })), /corpus/);
  assert.throws(() => validateSpec(spec({ generator: typed, corpus: [{ n: 1 }] })), /corpus/);
  assert.throws(() => validateSpec(spec({ generator: typed, corpus: [{ n: 1, flags: [true], extra: 1 }] })), /corpus/);
  const large = { type: 'array', minLength: 100, maxLength: 100, items: { type: 'string', minLength: 100, maxLength: 100, alphabet: '1' } };
  assert.throws(() => validateSpec(spec({ generator: large, corpus: Array(30).fill(Array(100).fill('1'.repeat(100))) })), /corpus/);
  const dense = { type: 'array', minLength: 100, maxLength: 100, items: { type: 'array', minLength: 100, maxLength: 100, items: { type: 'boolean' } } };
  assert.throws(() => validateSpec(spec({ generator: dense, corpus: [Array(100).fill(Array(100).fill(true))] })), /corpus/);
  assert.throws(() => validateSpec(spec({ invariant: { file: '../escape.mjs', export: 'test' } })), /invariant/);
});

test('fuzz checks invariants on generated inputs and keeps true results out of failures', sandboxed, async (t) => {
  const f = project(t);
  f.put('subject.mjs', 'export const subject = x => JSON.parse(x); export const invariant = (x,y) => x === "1" && y === 1;');
  f.git('add', '.'); f.git('commit', '-qm', 'passing fuzz invariant');
  const report = await execute(f, { ...fuzz, invariant: { ...subject, export: 'invariant' } });
  assert.equal(report.calls[0].source, 'generated');
  assert.equal(report.calls[0].result.invariant, true);
  assert.deepEqual(report.failures, []);
});

test('fuzz reports nonboolean invariant results as unknown', sandboxed, async (t) => {
  const f = project(t);
  f.put('subject.mjs', 'export const subject = x => x; export const invariant = () => "false";');
  f.git('add', '.'); f.git('commit', '-qm', 'invalid fuzz invariant');
  const report = await execute(f, { ...fuzz, corpus: ['1'], invariant: { ...subject, export: 'invariant' } });
  assert.equal(report.executed, 1);
  assert.equal(report.calls[0].source, 'corpus');
  assert.equal(report.failures[0].kind, 'UNKNOWN');
  assert.match(report.failures[0].result.reason, /must return true or false/);
});

test('fuzz spends the shared time budget on corpus calls before generation', sandboxed, async (t) => {
  const f = project(t);
  f.put('subject.mjs', 'export function subject() { while (true) {} }');
  f.git('add', '.'); f.git('commit', '-qm', 'hanging corpus');
  const report = await execute(f, { ...fuzz, corpus: ['1', '1'], timeBudgetMs: 200, callTimeoutMs: 30000 });
  assert.equal(report.executed, 1);
  assert.equal(report.calls[0].source, 'corpus');
  assert.equal(report.budgetExhausted, true);
  assert.deepEqual(report.failures, []);
});
