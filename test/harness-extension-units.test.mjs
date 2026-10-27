// Pure corpus rules and bounded filesystem observations.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { workspaceFiles, fileChanges } from '../lib/harness/effects.mjs';
import { mutate, outcomeClass } from '../lib/harness/corpus.mjs';
import { seeded } from '../lib/harness/generator.mjs';
import { boundaryCases } from '../lib/harness/metadata.mjs';
import { validateDecisionTable } from '../lib/models/decision-table.mjs';
function folder(t) {
  const root = mkdtempSync(join(tmpdir(), 'harness-observation-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}
test('file observation refuses oversized files and does not follow symbolic links', (t) => {
  const root = folder(t);
  symlinkSync('/etc/passwd', join(root, 'link'));
  assert.deepEqual(workspaceFiles(root).get('link'), { type: 'link', target: '/etc/passwd' });
  writeFileSync(join(root, 'large'), Buffer.alloc(1048577));
  assert.throws(() => workspaceFiles(root), /1 MiB/);
});
test('file observation records raw changes even when JSON normalization ignores their fields', (t) => {
  const root = folder(t);
  writeFileSync(join(root, 'value.json'), '{"id":1}');
  const before = workspaceFiles(root, ['id']);
  writeFileSync(join(root, 'value.json'), '{"id":2}');
  assert.equal(fileChanges(before, workspaceFiles(root, ['id']))[0].change, 'changed');
});
test('corpus mutations replay with a fixed seed and retain domain bounds', () => {
  const schema = { type: 'object', properties: { x: { type: 'integer', min: 0, max: 1 } } };
  assert.deepEqual(mutate(schema, { x: 1 }, seeded(5)), mutate(schema, { x: 1 }, seeded(5)));
  assert.ok([0, 1].includes(mutate(schema.properties.x, 1, seeded(5))));
  assert.notEqual(outcomeClass({ status: 'threw', error: { name: 'TypeError' } }), outcomeClass({ status: 'threw', error: { name: 'RangeError' } }));
  assert.notEqual(outcomeClass({ status: 'returned', output: 'x' }), outcomeClass({ status: 'returned', output: 1 }));
});
test('boundary generation refuses oversized string construction before allocation', (t) => {
  const root = folder(t);
  writeFileSync(join(root, 'schema.mjs'), "import { z } from 'zod'; export const schema = z.string().min(1000000000);");
  const result = boundaryCases(root, { file: 'schema.mjs', export: 'schema' });
  assert.equal(result.cases.length, 0);
  assert.ok(result.unknown.length > 0);
});
test('oracle references reject traversal and unknown fields', () => {
  const table = { tableVersion: 1, name: 'x', subject: { file: 'subject.mjs', export: 'subject' }, conditions: [{ name: 'x', values: [true] }],
    rules: [{ when: {}, then: true, oracle: { file: '../bad', suite: null, name: 'test', criterion: 'AC1', extra: true } }] };
  assert.equal(validateDecisionTable(table).ok, false);
});
