// Real restricted-worker fixtures for the extended harness modes.
import assert from 'node:assert/strict';
import { scanDeclaredPatterns } from '../lib/patterns.mjs';
import { test } from 'node:test';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { runHarness, harnessCommand } from '../lib/harness/run.mjs';
import { harnessInformation } from '../lib/harness/report.mjs';
import { validateSpec } from '../lib/harness/spec.mjs';
import { loadConfig } from '../lib/project.mjs';
import { authorize, project, sandboxed } from './worker-fixtures.mjs';
const subject = { file: 'subject.mjs', export: 'subject' };
const spec = (mode, rest) => ({ harnessVersion: 1, subject, mode, callTimeoutMs: 1500, ...rest });
function fixture(t, source) {
  const f = project(t);
  f.put('subject.mjs', source); f.put('inputs.json', '[1]');
  f.git('add', '.'); f.git('commit', '-qm', 'subject');
  return f;
}
async function execute(f, value) {
  const result = await runHarness(f.root, loadConfig(f.root), { authorization: authorize(f, harnessCommand), spec: value, store: f.store },
    { protectedFolders: [f.root, f.store, f.home], home: f.home });
  assert.equal(result.exitCode, 0, JSON.stringify(result.record.problems));
  return { ...result, report: JSON.parse(readFileSync(result.paths.artifact, 'utf8')) };
}

test('fault and boundary specs validate mode-specific control inputs', () => {
  assert.equal(validateSpec(spec('fault', { inputs: 'inputs.json', fault: 'reject', mustHandle: true })).fault, 'reject');
  assert.equal(validateSpec(spec('zod-boundaries', {})).mode, 'zod-boundaries');
  assert.throws(() => validateSpec(spec('fault', { inputs: 'inputs.json', fault: 'other', mustHandle: true })), /fault/);
  assert.throws(() => validateSpec(spec('fault', { inputs: '../x', fault: 'reject', mustHandle: true })), /inputs/);
  assert.throws(() => validateSpec(spec('fault', { inputs: 'inputs.json', fault: 'reject', mustHandle: 'yes' })), /mustHandle/);
});

test('differential captures logs, rejections and workspace file deltas', sandboxed, async (t) => {
  const f = fixture(t, `import { writeFileSync, unlinkSync } from 'node:fs';
export function subject() { console.log('base'); Promise.reject(new TypeError('unhandled')); writeFileSync('new.json', '{"id":1,"x":1}'); writeFileSync('old.txt', 'base'); unlinkSync('gone.txt'); return 1; }`);
  f.put('old.txt', 'old'); f.put('gone.txt', 'gone'); f.git('add', '.'); f.git('commit', '-qm', 'files');
  const base = f.git('rev-parse', 'HEAD');
  f.put('subject.mjs', readFileSync(join(f.root, 'subject.mjs'), 'utf8').replace("'base'", "'head'"));
  f.git('add', '.'); f.git('commit', '-qm', 'change');
  const { report } = await execute(f, spec('differential', { base, inputs: 'inputs.json' }));
  assert.equal(report.failures[0].kind, 'difference');
  const effects = report.calls[0].result.effects;
  assert.match(effects.stdout, /base/);
  assert.equal(effects.rejections[0].name, 'TypeError');
  assert.deepEqual(effects.files.map(x => [x.path, x.change]), [['gone.txt', 'removed'], ['new.json', 'created'], ['old.txt', 'changed']]);
});

test('differential normalizes JSON file contents with ignoreFields', sandboxed, async (t) => {
  const f = fixture(t, `import { writeFileSync } from 'node:fs'; export function subject() { writeFileSync('out.json', '{"id":1,"x":2}'); return 1; }`);
  const base = f.git('rev-parse', 'HEAD');
  f.put('subject.mjs', readFileSync(join(f.root, 'subject.mjs'), 'utf8').replace('"id":1', '"id":2'));
  f.git('add', '.'); f.git('commit', '-qm', 'id');
  const { report } = await execute(f, spec('differential', { base, inputs: 'inputs.json', ignoreFields: ['id'] }));
  assert.equal(report.failures.length, 0);
});

test('shrunk properties and fuzz crashes create run-local fixtures and skipped test skeletons', sandboxed, async (t) => {
  const f = fixture(t, 'export const subject = x => x; export const invariant = () => false; export const crash = () => { throw new TypeError("bad"); };');
  const common = { generator: { type: 'integer', min: 1, max: 3 }, seed: 4 };
  const property = await execute(f, spec('property', { ...common, count: 1, invariant: { ...subject, export: 'invariant' } }));
  const saved = JSON.parse(readFileSync(join(property.paths.folder, 'fixtures', 'case-0001.json'), 'utf8'));
  assert.equal(saved.input, 1); assert.equal(saved.seed, 4);
  assert.match(readFileSync(join(property.paths.folder, 'fixtures', 'case-0001.test.mjs'), 'utf8'), /node:test/);
  assert.equal(existsSync(join(f.root, 'fixtures')), false);
  const fuzz = await execute(f, spec('fuzz', { ...common, subject: { ...subject, export: 'crash' }, timeBudgetMs: 500 }));
  assert.equal(JSON.parse(readFileSync(join(fuzz.paths.folder, 'fixtures', 'case-0001.json'), 'utf8')).seed, 4);
});

test('fuzz keeps distinct outcome classes and mutates retained corpus seeds', sandboxed, async (t) => {
  const f = fixture(t, 'export const subject = x => x ? "yes" : 1;');
  const { report } = await execute(f, spec('fuzz', { generator: { type: 'boolean' }, seed: 1, timeBudgetMs: 1500 }));
  assert.equal(report.corpus.guidance, 'v8-block-and-outcome');
  assert.equal(report.corpus.size, 2);
  assert.ok(report.coverage.coveredBlocks > 0);
  assert.equal(report.coverage.history.length, report.executed);
  assert.equal(report.coverage.history.at(-1).corpusSize, report.corpus.size);
  assert.deepEqual(harnessInformation(JSON.stringify(report)).information.coverage, report.coverage);
  assert.equal(report.corpus.classes.length, 2);
  assert.ok(report.corpus.mutations > 0);
});

test('fault mode distinguishes missing timeouts, escaping errors and handled failures', sandboxed, async (t) => {
  const f = fixture(t, `export const subject = () => fetch('https://example.invalid');
export const handled = async () => { try { await fetch('https://example.invalid'); } catch { return 'handled'; } };
export const status = async () => (await fetch('https://example.invalid')).status;`);
  const reject = await execute(f, spec('fault', { inputs: 'inputs.json', fault: 'reject', mustHandle: true }));
  assert.equal(reject.report.failures[0].kind, 'escaped-error');
  const handled = await execute(f, spec('fault', { subject: { ...subject, export: 'handled' }, inputs: 'inputs.json', fault: 'reject', mustHandle: true }));
  assert.equal(handled.report.failures.length, 0);
  const hang = await execute(f, spec('fault', { inputs: 'inputs.json', fault: 'hang', mustHandle: true, callTimeoutMs: 300 }));
  assert.equal(hang.report.failures[0].kind, 'missing-timeout');
  const status = await execute(f, spec('fault', { subject: { ...subject, export: 'status' }, inputs: 'inputs.json', fault: 'status', status: 503, mustHandle: false }));
  assert.equal(status.report.calls[0].result.output, 503);
  assert.equal(harnessInformation(JSON.stringify(hang.report)).information.outcomes[0].kind, 'missing-timeout');
});

test('decision rows bind human oracle references and expose stale records', sandboxed, async (t) => {
  const f = fixture(t, 'export const subject = x => x.x;');
  const file = 'test/sum.test.mjs', digest = createHash('sha256').update(readFileSync(join(f.root, file))).digest('hex');
  const oracle = { file, suite: 'sum', name: 'adds two numbers', criterion: 'AC1' };
  f.put('.code-map/oracles.json', JSON.stringify({ oracleVersion: 1, entries: [{ ...oracle, digest, method: 'human review', confirmedBy: 'Tester', date: '2026-10-23' }] }));
  f.put('table.json', JSON.stringify({ tableVersion: 1, name: 'table', subject, conditions: [{ name: 'x', values: [1] }], rules: [{ when: {}, then: 1, oracle }] }));
  f.git('add', '.'); f.git('commit', '-qm', 'table');
  const current = await execute(f, spec('decision-table', { table: 'table.json' }));
  assert.equal(current.report.rows[0].confirmed, true); assert.equal(current.report.rows[0].current, true);
  f.put(file, '// changed\n'); f.git('add', '.'); f.git('commit', '-qm', 'stale');
  const stale = await execute(f, spec('decision-table', { table: 'table.json' }));
  assert.equal(stale.report.rows[0].current, false);
  assert.equal(harnessInformation(JSON.stringify(stale.report)).information.rows[0].current, false);
});

test('Zod boundary execution compares safeParse outcomes to discovered constraints', sandboxed, async (t) => {
  // Zod is unavailable in this checkout. A local fixture checks only the schema API contract.
  const f = fixture(t, `import { z } from './zod-fixture.mjs';
export const subject = z.number().min(1).max(2);`);
  f.put('zod-fixture.mjs', `export const z = { number() { return { min() { return this; }, max() { return this; }, safeParse(x) { return { success: x >= 1 && x <= 2 }; } }; } };`);
  // The extractor recognizes package imports. The package resolves to the committed local fixture.
  f.put('package.json', JSON.stringify({ type: 'module', imports: { '#unused': './zod-fixture.mjs' } }));
  f.put('node_modules/zod/package.json', JSON.stringify({ type: 'module', exports: './index.mjs' }));
  f.put('node_modules/zod/index.mjs', readFileSync(join(f.root, 'zod-fixture.mjs'), 'utf8'));
  f.put('subject.mjs', readFileSync(join(f.root, 'subject.mjs'), 'utf8').replace('./zod-fixture.mjs', 'zod'));
  f.git('add', '-f', 'node_modules/zod'); f.git('add', '.'); f.git('commit', '-qm', 'schema');
  const good = await execute(f, spec('zod-boundaries', {}));
  assert.ok(good.report.calls.length >= 3); assert.equal(good.report.failures.length, 0);
  f.put('node_modules/zod/index.mjs', 'export const z = { number() { return { min() { return this; }, max() { return this; }, safeParse() { return { success: true }; } }; } };');
  f.git('add', '-f', 'node_modules/zod'); f.git('commit', '-qm', 'broken schema');
  const bad = await execute(f, spec('zod-boundaries', {}));
  assert.equal(bad.report.failures[0].kind, 'mismatch');
});

test('fault hangs respect subject abort signals and subject-owned timeout races', sandboxed, async (t) => {
  const f = fixture(t, `export const subject = async () => { try { await fetch('https://example.invalid', { signal: AbortSignal.timeout(20) }); } catch { return 'handled'; } };
export const race = async () => Promise.race([fetch('https://example.invalid'), new Promise(resolve => setTimeout(() => resolve('fallback'), 20))]);`);
  const common = { inputs: 'inputs.json', fault: 'hang', mustHandle: true };
  const aborted = await execute(f, spec('fault', common));
  assert.equal(aborted.report.calls[0].result.output, 'handled');
  assert.equal(aborted.report.failures.length, 0);
  const race = await execute(f, spec('fault', { ...common, subject: { ...subject, export: 'race' } }));
  assert.equal(race.report.calls[0].result.output, 'fallback');
  assert.equal(race.report.failures.length, 0);
});

test('late unhandled rejections remain visible after the subject returns', sandboxed, async (t) => {
  const f = fixture(t, `export function subject() { setTimeout(() => { Promise.reject(new RangeError('late')); }, 10); return 1; }`);
  const { report } = await execute(f, spec('differential', { base: 'HEAD', inputs: 'inputs.json' }));
  assert.equal(report.calls[0].result.effects.rejections[0].name, 'RangeError');
});

test('fuzz retains block discoveries even when every returned output has the same type', sandboxed, async (t) => {
  const f = fixture(t, 'export function subject(x) { if (x) { return 1; } return 2; }');
  const { report } = await execute(f, spec('fuzz', { generator: { type: 'boolean' }, seed: 1, timeBudgetMs: 1500 }));
  assert.equal(report.corpus.classes.length, 1);
  assert.equal(report.corpus.size, 2);
  assert.ok(report.coverage.coveredBlocks > report.calls[0].result.coverage.blocks.length);
  assert.equal(report.coverage.history.at(-1).coveredBlocks, report.corpus.blocks.length);
  assert.equal(harnessInformation(JSON.stringify(report)).information.coverage.measure, 'v8-block');
});


test('a declared retry path exhausts its bound and logs the injected fetch failure', sandboxed, async (t) => {
  // Network interception makes remote failure deterministic without calling a remote service.
  const source = `async function retry(task, { maxAttempts }) {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try { return await task(); } catch (error) { if (attempt === maxAttempts) throw error; }
    }
  }
  export async function subject() {
    try { return await retry(() => fetch('https://example.invalid'), { maxAttempts: 3 }); }
    catch (error) { console.error(error); return 'exhausted'; }
  }`;
  const policy = { path: 'subject.mjs', symbol: 'subject', retry: { callee: 'retry', maxAttempts: 3 }, logging: { callee: 'console.error' } };
  assert.deepEqual(scanDeclaredPatterns(new Map([['subject.mjs', source]]), [policy]).map(x => x.state), ['OBSERVED', 'OBSERVED']);
  const f = fixture(t, source);
  const { report } = await execute(f, spec('fault', { inputs: 'inputs.json', fault: 'reject', mustHandle: true }));
  assert.deepEqual(report.failures, []);
  assert.equal(report.calls[0].result.faultCalls, 3);
  assert.equal(report.calls[0].result.output, 'exhausted');
  assert.match(report.calls[0].result.effects.stderr, /Injected fetch failure/);
});
