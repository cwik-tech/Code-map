// Review regressions distinguish subject behavior from harness failures.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { runHarness, harnessCommand } from '../lib/harness/run.mjs';
import { harnessInformation } from '../lib/harness/report.mjs';
import { loadConfig } from '../lib/project.mjs';
import { authorize, project, sandboxed } from './worker-fixtures.mjs';
const subject = { file: 'subject.mjs', export: 'subject' };
async function execute(t, source, parameters = {}) {
  const f = project(t);
  f.put('subject.mjs', source); f.put('inputs.json', '[1]');
  f.git('add', '.'); f.git('commit', '-qm', 'subject');
  const spec = { harnessVersion: 1, mode: 'differential', subject, base: 'HEAD', inputs: 'inputs.json', callTimeoutMs: 2000, ...parameters };
  if (spec.mode !== 'differential') { delete spec.base; delete spec.inputs; }
  const authorization = authorize(f, harnessCommand);
  const result = await runHarness(f.root, loadConfig(f.root), { authorization, spec, store: f.store }, { protectedFolders: [f.root, f.store, f.home], home: f.home });
  assert.equal(result.exitCode, 0, JSON.stringify(result.record.problems));
  return JSON.parse(readFileSync(result.paths.artifact, 'utf8'));
}

test('matching invalid subject exports give UNKNOWN rather than a clean differential run', sandboxed, async (t) => {
  const report = await execute(t, 'export const subject = {};');
  assert.equal(report.calls[0].result.status, 'UNKNOWN');
  assert.equal(report.failures[0].kind, 'UNKNOWN');
});

test('matching normalization failures do not masquerade as matching subject exceptions', sandboxed, async (t) => {
  const report = await execute(t, 'export const subject = () => "x".repeat(65537);');
  assert.equal(report.calls[0].result.status, 'UNKNOWN');
  assert.equal(report.failures[0].kind, 'UNKNOWN');
});

test('real matching subject exceptions remain comparable outcomes', sandboxed, async (t) => {
  const report = await execute(t, 'export const subject = () => { throw new Error("expected"); };');
  assert.equal(report.calls[0].result.status, 'threw');
  assert.equal(report.failures.length, 0);
});

test('fuzz records an abnormal process exit even after it emitted a return value', sandboxed, async (t) => {
  const report = await execute(t, 'export const subject = x => { process.exitCode = 7; return x; };',
    { mode: 'fuzz', base: undefined, inputs: undefined, generator: { type: 'boolean' }, seed: 1, timeBudgetMs: 600 });
  assert.equal(report.failures[0].kind, 'crash');
});

test('property shrinking never records more than 100 attempted candidates', sandboxed, async (t) => {
  const item = { type: 'integer', min: 0, max: 1000000000 };
  const report = await execute(t, 'export const subject = x => x; export const invariant = x => x.a === 0 || x.b === 0;',
    { mode: 'property', base: undefined, inputs: undefined, generator: { type: 'object', properties: { a: item, b: item } }, seed: 6, count: 1, invariant: { ...subject, export: 'invariant' } });
  assert.ok(report.failures[0].shrinkAttempts <= 100, `Recorded ${report.failures[0].shrinkAttempts} attempts`);
  assert.equal(report.calls.length, report.failures[0].shrinkAttempts + 1);
});

test('verify enforces the 16 MiB harness report limit before parsing', () => {
  assert.match(harnessInformation(' '.repeat(16 * 1024 * 1024 + 1)).error, /16 MiB/);
});

test('a declared but missing TypeScript loader is refused before execution', sandboxed, async (t) => {
  const f = project(t);
  f.put('subject.ts', 'export const subject = (x: number) => x;');
  f.put('package.json', JSON.stringify({ type: 'module', devDependencies: { tsx: '4.0.0' } }));
  f.git('add', '.'); f.git('commit', '-qm', 'typescript');
  const authorization = authorize(f, harnessCommand);
  await assert.rejects(runHarness(f.root, loadConfig(f.root), { authorization, store: f.store,
    spec: { harnessVersion: 1, mode: 'fuzz', subject: { file: 'subject.ts', export: 'subject' }, seed: 1, generator: { type: 'boolean' }, timeBudgetMs: 10 } }), /installed project tsx/);
});
