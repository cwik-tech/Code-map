import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { decodeEnrichment, enrichmentTasks, validateEnrichment } from '../lib/enrich.mjs';
import { fileHash } from '../lib/mutation.mjs';
import { testHash } from '../lib/test-labels.mjs';

const text = 'export const a = 1;';
function facts() {
  return { files: [{ path: 'src/a.mjs', exports: ['a'] }], testFacts: [{ path: 'test/a.test.mjs', testScan: { cases: [{ name: 'works' }] } }],
    texts: new Map([['src/a.mjs', text], ['test/a.test.mjs', 'test source']]), descriptions: { files: {} }, labels: { files: {} } };
}

test('enrichment refreshes changed source bodies and missing cases but reuses current file results', () => {
  const data = facts();
  assert.deepEqual(enrichmentTasks(data).map(item => [item.kind, item.path]), [['description', 'src/a.mjs'], ['labels', 'test/a.test.mjs']]);
  data.descriptions.files['src/a.mjs'] = { summary: 'A number.', sourceHash: fileHash(text) };
  data.labels.files['test/a.test.mjs'] = { hash: testHash('test source'), cases: { works: { intent: 'happy' } } };
  assert.deepEqual(enrichmentTasks(data), []);
  data.texts.set('src/a.mjs', 'export const a = 2;');
  assert.deepEqual(enrichmentTasks(data).map(item => item.path), ['src/a.mjs']);
  data.testFacts[0].testScan.cases.push({ name: 'rejects' });
  assert.deepEqual(enrichmentTasks(data).map(item => item.path), ['src/a.mjs', 'test/a.test.mjs']);
});

const descriptionTask = [{ kind: 'description', path: 'src/a.mjs', source: text, cases: [] }];
const description = (summary) => ({ items: [{ kind: 'description', path: 'src/a.mjs', summary, cases: [] }] });
for (const [name, summary] of [['empty', ''], ['whitespace', '  '], ['oversized', 'x'.repeat(1001)], ['non-string', 12]]) {
  test(`rejects an ${name} model description`, () => {
    assert.throws(() => validateEnrichment(description(summary), descriptionTask), /model output/i);
  });
}

for (const [name, cases] of [
  ['unknown', [{ name: 'unknown', intent: 'happy', note: '' }]],
  ['duplicate', [{ name: 'works', intent: 'happy', note: '' }, { name: 'works', intent: 'edge', note: '' }]],
  ['malformed', [null]],
  ['oversized note', [{ name: 'works', intent: 'happy', note: 'x'.repeat(501) }]],
]) {
  test(`rejects ${name} model test cases`, () => {
    const tasks = enrichmentTasks(facts()).filter(item => item.kind === 'labels');
    assert.throws(() => validateEnrichment({ items: [{ kind: 'labels', path: 'test/a.test.mjs', summary: '', cases }] }, tasks), /model output/i);
  });
}

for (const [name, response] of [
  ['malformed JSON', '{'], ['non-object', 'null'], ['provider failure', JSON.stringify({ is_error: true, structured_output: description('A number.') })],
  ['missing structured output', '{}'], ['incomplete structured output', JSON.stringify({ structured_output: { items: [] } })],
]) {
  test(`rejects a provider response with ${name}`, () => {
    assert.throws(() => decodeEnrichment(response, descriptionTask), /Claude enrichment failed/i);
  });
}

test('decodes a complete provider response before returning validated descriptions', () => {
  const results = decodeEnrichment(JSON.stringify({ structured_output: description('A number.') }), descriptionTask);
  assert.equal(results[0].summary, 'A number.');
});

test('model output must cover exactly the requested paths and cases with valid intents', () => {
  const tasks = enrichmentTasks(facts());
  const result = { items: [
    { kind: 'description', path: 'src/a.mjs', summary: 'A number.', cases: [] },
    { kind: 'labels', path: 'test/a.test.mjs', summary: '', cases: [{ name: 'works', intent: 'happy', note: '' }] },
  ] };
  assert.equal(validateEnrichment(result, tasks).length, 2);
  assert.throws(() => validateEnrichment(null, tasks), /model output/i);
  assert.throws(() => validateEnrichment({ items: [] }, tasks), /complete/i);
  assert.throws(() => validateEnrichment({ items: [...result.items, result.items[0]] }, tasks), /complete|duplicate/i);
  assert.throws(() => validateEnrichment({ items: [{ ...result.items[0], path: '../../outside' }, result.items[1]] }, tasks), /path|unexpected/i);
  assert.throws(() => validateEnrichment({ items: [result.items[0], { ...result.items[1], cases: [] }] }, tasks), /case/i);
  assert.throws(() => validateEnrichment({ items: [result.items[0], { ...result.items[1], cases: [{ name: 'works', intent: 'perfect', note: '' }] }] }, tasks), /intent/i);
});

test('model paths and kinds must be strings rather than values coercible to requested keys', () => {
  assert.throws(() => validateEnrichment({ items: [{ kind: ['description'], path: 'src/a.mjs', summary: 'A number.', cases: [] }] }, descriptionTask), /model output/i);
  assert.throws(() => validateEnrichment({ items: [{ kind: 'description', path: ['src/a.mjs'], summary: 'A number.', cases: [] }] }, descriptionTask), /model output/i);
});


test('invalid provider output rejects the enrichment promise instead of crashing its caller', { skip: process.platform === 'win32' }, t => {
  const root = mkdtempSync(join(tmpdir(), 'code-map-invalid-provider-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  // The paid, nondeterministic provider is replaced at its external executable boundary.
  const provider = join(root, 'claude');
  writeFileSync(provider, '#!/usr/bin/env node\nprocess.stdin.resume(); process.stdin.on("end", () => process.stdout.write("{"));\n', { mode: 0o755 });
  const source = `import { enrich } from ${JSON.stringify(new URL('../lib/enrich.mjs', import.meta.url).href)};
    const facts = { files: [{ path: 'a.mjs' }], testFacts: [], texts: new Map([['a.mjs', 'export const a=1;']]), descriptions: { files: {} }, labels: { files: {} } };
    try { await enrich(facts); process.stdout.write('unexpected success'); }
    catch (error) { process.stdout.write(JSON.stringify({ message: error.message, cause: error.cause?.message, files: facts.descriptions.files })); }`;
  const env = { ...process.env, CODE_MAP_CLAUDE: provider };
  delete env.NODE_TEST_CONTEXT;
  const result = spawnSync(process.execPath, ['--input-type=module', '--eval', source], { env, encoding: 'utf8', timeout: 2000 });
  assert.equal(result.status, 0, result.stderr);
  const error = JSON.parse(result.stdout);
  assert.match(error.message, /invalid or incomplete response/);
  assert.ok(error.cause);
  assert.deepEqual(error.files, {});
});
