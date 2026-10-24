// Traceability (C30): changed files and folders aggregate the cognitive complexity sum and maximum of their functions.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compareAreas } from '../lib/complexity-areas.mjs';

const complexity = (cyclomatic, nesting, cognitive, start = 1, end = 1) => ({ cyclomatic, nesting, cognitive, start, end });
const analysis = (declarations) => ({ files: [{ path: 'src/a.ts', lines: 3, declarations }] });

test('changed files and folders report cognitive sums and maxima with their deltas', () => {
  const base = analysis([
    { name: 'one', lines: 1, complexity: complexity(1, 0, 3) },
    { name: 'two', lines: 2, complexity: complexity(2, 1, 7, 2, 3) },
  ]);
  const head = analysis([
    { name: 'one', lines: 1, complexity: complexity(1, 0, 4) },
    { name: 'two', lines: 4, complexity: complexity(3, 2, 9, 2, 5) },
  ]);
  const areas = compareAreas(base, head, ['src/a.ts']);
  const file = areas.files.find((row) => row.path === 'src/a.ts');
  assert.deepEqual([file.base.sum, file.base.max], [10, 7], 'the base sums and maxima of the two functions');
  assert.deepEqual([file.head.sum, file.head.max], [13, 9], 'the head sums and maxima of the two functions');
  assert.deepEqual([file.delta.sum, file.delta.max], [3, 2], 'the deltas of the cognitive sum and maximum');
  const folder = areas.folders.find((row) => row.path === 'src');
  assert.deepEqual([folder.base.sum, folder.base.max], [10, 7], 'the folder aggregates the same functions');
  assert.deepEqual([folder.head.sum, folder.head.max], [13, 9]);
  assert.deepEqual([folder.delta.sum, folder.delta.max], [3, 2]);
});

test('complexity observations report small growth without rejecting unchanged large metrics', async () => {
  const { compareComplexity } = await import('../lib/complexity.mjs');
  const fn = (name, value) => ({ name, lines: 1, complexity: complexity(value, value, value) });
  const base = analysis([fn('large', 1000), fn('small', 1)]);
  const head = analysis([fn('large', 1000), fn('small', 2)]);
  const result = compareComplexity(base, head);
  assert.deepEqual(result.counts, { grew: 1, new: 0, fell: 0, unknown: 0 });
  assert.deepEqual(result.grew.map((item) => [item.name, item.delta]), [
    ['small', { lines: 0, cyclomatic: 1, nesting: 1, cognitive: 1 }],
  ]);
});
