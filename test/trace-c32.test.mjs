import assert from 'node:assert/strict';
import { test } from 'node:test';
import { repository } from './packages-fixture.mjs';

test('newly orphaned files precede existing orphans in the summary and finding page', (t) => {
  const f = repository(t, {
    'package.json': '{"name":"pkg","main":"src/index.ts"}',
    'src/index.ts': 'import { value } from "./z-new"; export const main = value;',
    'src/a-existing.ts': 'export const old = 1;', 'src/z-new.ts': 'export const value = 2;',
  });
  f.put('src/index.ts', 'export const main = 1;');
  f.git('add', '.'); f.git('commit', '-qm', 'orphan the feature');
  const summary = f.json(['inspect', '--summary', '--ref', 'HEAD', '--base', 'HEAD~1', '--store', f.store]);
  const expected = [['src/z-new.ts', 'NEW'], ['src/a-existing.ts', 'EXISTING']];
  assert.deepEqual(summary.findings.items.filter((item) => item.ruleId === 'FILE-ORPHANED').map((item) => [item.location.path, item.baseline]), expected);
  const page = f.json(['inspect', '--analysis', summary.analysis.id, '--base-analysis', summary.comparison.base.id,
    '--findings', '--rule', 'FILE-ORPHANED', '--store', f.store]);
  assert.deepEqual(page.page.items.map((item) => [item.location.path, item.baseline]), expected);
});
