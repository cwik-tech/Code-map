import assert from 'node:assert/strict';
import { test } from 'node:test';
import { enrichmentTasks, validateEnrichment } from '../lib/enrich.mjs';
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
