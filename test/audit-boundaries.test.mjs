// Boundary execution uses the real restricted worker and explicit validator functions.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { runHarness, harnessCommand } from '../lib/harness/run.mjs';
import { loadConfig } from '../lib/project.mjs';
import { harnessInformation } from '../lib/harness/report.mjs';
import { authorize, project, sandboxed } from './worker-fixtures.mjs';
import { analyzed, repository } from './nextjs-fixture.mjs';
test('inspection collects JSON Schema boundaries from snapshot files', (t) => {
  const f = repository(t, { 'package.json': '{}', 'src/app.js': 'export const x = 1;', 'age.schema.json': '{"type":"integer","minimum":18}' });
  const { analysis } = analyzed(f.root);
  assert.equal(analysis.models.boundaries.find((x) => x.source === 'json-schema')?.fields[0].values[0].value, 17);
});
test('JSON Schema boundary runs retain expected outcomes and actual call links', sandboxed, async (t) => {
  const f = project(t);
  f.put('age.schema.json', '{"type":"integer","minimum":18,"exclusiveMaximum":21}');
  f.put('subject.mjs', 'export const accepts = (x) => Number.isInteger(x) && x >= 18 && x < 21;');
  f.git('add', '.'); f.git('commit', '-qm', 'boundary subject');
  const result = await runHarness(f.root, loadConfig(f.root), { authorization: authorize(f, harnessCommand), store: f.store,
    spec: { harnessVersion: 1, mode: 'json-boundaries', schema: 'age.schema.json', subject: { file: 'subject.mjs', export: 'accepts' } } },
  { protectedFolders: [f.root, f.home, f.store], home: f.home });
  assert.equal(result.exitCode, 0, JSON.stringify(result.record.problems));
  const report = JSON.parse(readFileSync(result.paths.artifact, 'utf8'));
  assert.equal(report.executed, 6);
  assert.equal(report.failures.length, 0);
  assert.deepEqual(report.boundaryResults[0], { case: 0, call: 0, expected: false, actual: false });
  assert.equal(harnessInformation(JSON.stringify(report)).information.boundaries.cases.length, 6);
});
test('range annotation runs detect validator disagreements', sandboxed, async (t) => {
  const f = project(t);
  f.put('subject.mjs', '/** @minimum 18 @maximum 20 */\nexport const accepts = (x) => x >= 17 && x <= 20;');
  f.git('add', '.'); f.git('commit', '-qm', 'annotated validator');
  const result = await runHarness(f.root, loadConfig(f.root), { authorization: authorize(f, harnessCommand), store: f.store,
    spec: { harnessVersion: 1, mode: 'range-boundaries', subject: { file: 'subject.mjs', export: 'accepts' } } },
  { protectedFolders: [f.root, f.home, f.store], home: f.home });
  assert.equal(result.exitCode, 0);
  const report = JSON.parse(readFileSync(result.paths.artifact, 'utf8'));
  assert.equal(report.failures[0].kind, 'mismatch');
  assert.equal(report.failures[0].input, 17);
});
test('unsupported JSON Schema constraints produce UNKNOWN without executed passes', sandboxed, async (t) => {
  const f = project(t);
  f.put('age.schema.json', '{"type":"integer","minimum":18,"multipleOf":2}');
  f.put('subject.mjs', 'export const accepts = () => true;');
  f.git('add', '.'); f.git('commit', '-qm', 'unsupported schema');
  const result = await runHarness(f.root, loadConfig(f.root), { authorization: authorize(f, harnessCommand), store: f.store,
    spec: { harnessVersion: 1, mode: 'json-boundaries', schema: 'age.schema.json', subject: { file: 'subject.mjs', export: 'accepts' } } },
  { protectedFolders: [f.root, f.home, f.store], home: f.home });
  assert.equal(result.exitCode, 0);
  const report = JSON.parse(readFileSync(result.paths.artifact, 'utf8'));
  assert.equal(report.executed, 0);
  assert.equal(report.failures[0].kind, 'UNKNOWN');
});
