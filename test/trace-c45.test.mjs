import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validateResults } from '../lib/verification-schema.mjs';
import { categories } from '../lib/ratings.mjs';
import { project, outcome } from './oracle-fixtures.mjs';

test('stored reports require supported result and rubric schema versions', (t) => {
  const f = project(t), { results } = outcome(f.verify(f.request()), 3);
  assert.equal(results.schemaVersion, 1);
  assert.equal(results.rubric.schemaVersion, 1);
  assert.equal(validateResults(results).ok, true);
  const futureResults = validateResults({ ...results, schemaVersion: 2 });
  assert.equal(futureResults.ok, false);
  assert.ok(futureResults.errors.some((x) => x.path === 'results.schemaVersion'));
  const futureRubric = validateResults({ ...results, rubric: { ...results.rubric, schemaVersion: 2 } });
  assert.equal(futureRubric.ok, false);
  assert.ok(futureRubric.errors.some((x) => x.path === 'results.rubric.schemaVersion'));
});

test('a four-category verification report contains no combined rating in JSON or Markdown', (t) => {
  const f = project(t), { results, markdown } = outcome(f.verify(f.request()), 3);
  assert.deepEqual(Object.keys(results.ratings), categories);
  const forbidden = ['score', 'total', 'average', 'weight', 'weights', 'combined', 'verificationScore'];
  assert.deepEqual(Object.keys(results).filter((key) => forbidden.includes(key)), []);
  assert.deepEqual(Object.values(results.ratings).flatMap((rating) => Object.keys(rating).filter((key) => forbidden.includes(key))), []);
  assert.doesNotMatch(markdown, /(?:overall|combined|average|total)\s+(?:rating|score)|verification score/i);
});

test('a report lists a real architecture blocker and preserves raw discovery measurements and category reasons', (t) => {
  const f = project(t, { '.code-map.json': JSON.stringify({ rules: ['core -> ui'] }),
    'src/core/engine.ts': 'export const engine = 1;\n', 'src/ui/view.ts': 'export const view = 1;\n' });
  f.put('src/core/engine.ts', "import { view } from '../ui/view'; export const engine = view;\n"); f.commit('break architecture');
  const { results, markdown } = outcome(f.verify(f.request()), 2);
  assert.equal(results.obligations.find((x) => x.id === 'structure.architecture-rules').result, 'FAIL');
  assert.ok(results.readiness.blocking.includes('structure.architecture-rules'));
  assert.match(markdown, /## Failed checks[\s\S]*structure\.architecture-rules/);
  assert.deepEqual(results.completeness.find((x) => x.stack === 'TypeScript'), { stack: 'TypeScript',
    discovered: 3, supported: 3, parsed: 3, skipped: 0, malformed: 0, dynamicallyUnresolved: 0 });
  assert.equal(results.ratings.structuralIntegrity.value, 1);
  assert.ok(results.ratings.structuralIntegrity.reason.includes('si.'));
  assert.ok(results.ratings.structuralIntegrity.evidenceCompleteness.required.completed >= 1);
});
