// Regression tests for model input limits, numeric boundaries and static event facts.
import assert from 'node:assert/strict';
import { rmSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { analyzeFile } from '../lib/analyze.mjs';
import { collect } from '../lib/build.mjs';
import { loadConfig } from '../lib/project.mjs';
import { readModelFiles, maxModelBytes } from '../lib/models/model-files.mjs';
import { testModelFacts } from '../lib/models/test-facts.mjs';
import { checkStateModel } from '../lib/models/state-model.mjs';
import { repository } from './nextjs-fixture.mjs';

const fields = (expression) => analyzeFile('src/schema.ts', `import { z } from 'zod';\nexport const A = ${expression};`, () => null).models.schemas[0].fields;

test('collection applies model limits before loading JSON metadata', (t) => {
  const path = '.code-map/models/big.json';
  const { root } = repository(t, { 'src/a.ts': 'export const a = 1;', [path]: ' '.repeat(maxModelBytes + 1) });
  const facts = collect(root, loadConfig(root), { ref: 'HEAD' });
  assert.equal(facts.texts.has(path), false);
  assert.deepEqual(facts.models.errors.map(({ reason }) => reason), ['too-large']);
});

test('tracked models under a replaced folder cannot read a symbolic link', (t) => {
  const path = '.code-map/models/a.json';
  const { root } = repository(t, { 'src/a.ts': 'export const a = 1;', [path]: '{}' });
  const outside = repository(t, { 'a.json': '{"name":"outside"}' });
  rmSync(join(root, '.code-map/models'), { recursive: true });
  symlinkSync(outside.root, join(root, '.code-map/models'));
  const result = readModelFiles(root, null, [path]);
  assert.deepEqual(result.files, []);
  assert.deepEqual(result.errors.map(({ reason }) => reason), ['outside-repository']);
});

test('tiny numeric limits do not crash or collapse distinct boundary values', () => {
  const [field] = fields('z.number().min(1e-100)');
  assert.deepEqual(field.values.map(({ value }) => value), [9e-101, 1e-100, 1.1e-100]);
});

test('an unsupported method with an Object prototype name stays PARTIAL', () => {
  const [field] = fields('z.number().min(1).toString()');
  assert.equal(field.state, 'PARTIAL');
  assert.deepEqual(field.unread, ['toString']);
});

test('an integer-only schema supplies fractional cases around zero', () => {
  const [field] = fields('z.number().int()');
  assert.deepEqual(field.values.map(({ value, expected }) => [value, expected]), [[-0.5, 'invalid'], [0, 'valid'], [0.5, 'invalid']]);
});

test('quoted event types count and overwritten or spread event types stay unknown', () => {
  const facts = testModelFacts('test/a.test.ts', "send({ 'type': 'OPEN' }); send({ type: 'WRONG', type: 'CLOSE' }); send({ type: 'HIDDEN', ...data });");
  assert.deepEqual([...facts.sends], ['OPEN', 'CLOSE']);
});

test('non-literal event handlers prevent claims that a sent event is unhandled', () => {
  const file = analyzeFile('src/machine.ts', "import { createMachine } from 'xstate';\nconst m = createMachine({ initial: 'a', states: { a: { on: handlers } } });", () => null);
  const result = checkStateModel(file.models.machines[0], new Map([['GO', ['test/a.test.ts']]]));
  assert.deepEqual(result.unknownEvents, []);
});
