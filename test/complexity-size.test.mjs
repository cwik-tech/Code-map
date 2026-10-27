// Size evidence remains independent of cognitive evidence and uncertain rename matching.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { compareSymbolSizes } from '../lib/complexity-size.mjs';
import { compareAreas } from '../lib/complexity-areas.mjs';
const file = (path, lines) => ({ path, lines, declarations: [{ name: 'stable', lines, complexity: { cyclomatic: 1, nesting: 0 } }] });

test('unmatched symbols stay unknown when the rename list is incomplete', () => {
  const result = compareSymbolSizes({ files: [file('old.ts', 3)] }, { files: [file('new.ts', 5)] }, ['old.ts', 'new.ts'], [], false);
  assert.deepEqual(result.map(x => [x.state, x.delta]), [['UNKNOWN', null], ['UNKNOWN', null]]);
});

test('known size facts survive missing cognitive metrics', () => {
  const areas = compareAreas({ files: [file('src/a.ts', 3)] }, { files: [file('src/a.ts', 5)] }, ['src/a.ts']);
  assert.deepEqual([areas.files[0].base.lines, areas.files[0].head.lines, areas.files[0].delta.lines], [3, 5, 2]);
  assert.equal(areas.files[0].delta.sum, null);
});

test('duplicate declaration names never produce a guessed size delta', () => {
  const item = file('a.ts', 3);
  item.declarations.push({ ...item.declarations[0], lines: 4 });
  const result = compareSymbolSizes({ files: [item] }, { files: [file('a.ts', 5)] }, ['a.ts']);
  assert.equal(result[0].state, 'UNKNOWN');
  assert.equal(result[0].delta, null);
});
