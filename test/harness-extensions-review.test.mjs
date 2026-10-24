// Review regressions for evidence loss and untrusted result boundaries.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runHarness, harnessCommand } from '../lib/harness/run.mjs';
import { harnessInformation } from '../lib/harness/report.mjs';
import { boundaryCases } from '../lib/harness/metadata.mjs';
import { validateDecisionTable } from '../lib/models/decision-table.mjs';
import { loadConfig } from '../lib/project.mjs';
import { authorize, project, sandboxed } from './worker-fixtures.mjs';
const subject = { file: 'subject.mjs', export: 'subject' };
async function execute(t, source, extra = {}) {
  const f = project(t);
  f.put('subject.mjs', source); f.git('add', '.'); f.git('commit', '-qm', 'subject');
  const spec = { harnessVersion: 1, mode: 'fuzz', subject, callTimeoutMs: 1000, seed: 1, timeBudgetMs: 2000, generator: { type: 'boolean' }, ...extra };
  const result = await runHarness(f.root, loadConfig(f.root), { spec, store: f.store, authorization: authorize(f, harnessCommand) },
    { protectedFolders: [f.root, f.store, f.home], home: f.home });
  assert.equal(result.exitCode, 0, JSON.stringify(result.record.problems));
  return { ...result, report: JSON.parse(readFileSync(result.paths.artifact, 'utf8')) };
}

test('fuzz treats captured unhandled rejections as crashes and writes their fixtures', sandboxed, async (t) => {
  const result = await execute(t, 'export const subject = x => { Promise.reject(new RangeError("bad")); return x; };');
  assert.equal(result.report.failures[0].kind, 'crash');
  assert.equal(JSON.parse(readFileSync(join(result.paths.folder, 'fixtures', 'case-0001.json'), 'utf8')).seed, 1);
});

test('rejections observed before a hang survive forced termination', sandboxed, async (t) => {
  const result = await execute(t, 'export const subject = () => { Promise.reject(new TypeError("before hang")); return new Promise(() => { setInterval(() => {}, 10000); }); };');
  assert.equal(result.report.calls[0].result.effects.rejections[0].name, 'TypeError');
});

test('console capture remains bounded when the subject exceeds its cap', sandboxed, async (t) => {
  const result = await execute(t, 'export const subject = () => { console.log("x".repeat(300000)); return 1; };');
  assert.equal(result.report.calls[0].result.status, 'UNKNOWN');
  assert.ok(Buffer.byteLength(result.report.calls[0].result.effects.stdout) <= 262144);
});

test('verify rejects malformed side effects, corpus metadata and trusted rows', () => {
  const report = { reportType: 'code-map-harness', harnessVersion: 1, mode: 'fault', finite: true, calls: [], failures: [], executed: 0 };
  assert.match(harnessInformation(JSON.stringify({ ...report, rows: 'confirmed' })).error, /row/i);
  assert.match(harnessInformation(JSON.stringify({ ...report, corpus: { size: -1 } })).error, /corpus/i);
  const calls = [{ side: 'head', input: 1, result: { status: 'returned', output: 1, durationMs: 0, effects: { stdout: 4 } } }];
  assert.match(harnessInformation(JSON.stringify({ ...report, calls, executed: 1 })).error, /effect/i);
});

test('object boundary baselines refuse oversized peer strings before construction', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'harness-peer-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(join(root, 'schema.mjs'), "import { z } from 'zod'; export const schema = z.object({ n: z.number().min(0), s: z.string().min(10001) });");
  assert.equal(boundaryCases(root, { file: 'schema.mjs', export: 'schema' }).cases.length, 0);
});

test('table oracle references accept the full name length of human records', () => {
  const oracle = { file: 'test/a.test.mjs', suite: 's'.repeat(1000), name: 'n'.repeat(1000), criterion: 'AC1' };
  const table = { tableVersion: 1, name: 'table', subject, conditions: [{ name: 'x', values: [1] }], rules: [{ when: {}, then: 1, oracle }] };
  assert.equal(validateDecisionTable(table).ok, true);
});
