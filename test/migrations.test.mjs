// Migration extraction uses the installed TypeScript parser and the normal finding comparator.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { migrationUses, migrationProblems } from '../lib/migrations.mjs';
import { deriveFindings } from '../lib/findings.mjs';
import { compareFindings } from '../lib/compare.mjs';

const pattern = { from: 'old', to: 'next', note: 'Replace old.' };
const analysis = (text) => ({ files: [{ path: 'src/use.ts', imports: [], exports: [] }], cycles: { all: [], value: [] }, sharedTypes: [],
  migrations: migrationUses(new Map([['src/use.ts', text]]), [pattern]) });
const stored = (text) => { const data = analysis(text); return { data: { analysis: data }, findings: deriveFindings(data) }; };
for (const [kind, use] of [['import-path', "import x from 'old';"], ['import-name', "import { old as local } from 'pkg';"], ['call', 'old();']]) {
  test(`${kind} migration uses have EXISTING, NEW and RESOLVED identities`, () => {
    const base = stored(use), head = stored(`${use}\n${use}`);
    const options = { comparability: { state: 'COMPARABLE' } };
    const comparison = compareFindings(base, head, options);
    assert.deepEqual(Object.values(comparison.statuses).map((item) => item.baseline), ['EXISTING', 'NEW']);
    assert.equal(compareFindings(head, base, options).resolved.length, 1);
    assert.equal(base.findings[0].facts.kind, kind);
    assert.equal(base.findings[0].facts.note, pattern.note);
    assert.equal(base.findings[0].facts.to, pattern.to);
    assert.equal(base.findings[0].location.line, 1);
  });
}

test('migration syntax excludes comments and strings and includes type imports, member calls and literal loaders', () => {
  const uses = migrationUses(new Map([['src/use.ts', `// old()
const text = 'old()';
import type { old } from 'pkg';
api.old();
import('old');
require('old');
`]]), [pattern]);
  assert.deepEqual(uses.map((item) => [item.kind, item.line]), [['import-name', 3], ['call', 4], ['import-path', 5], ['import-path', 6]]);
});

test('migration configuration rejects malformed patterns at the boundary', () => {
  assert.deepEqual(migrationProblems(undefined), []);
  assert.deepEqual(migrationProblems([pattern]), []);
  assert.ok(migrationProblems(null).length);
  assert.ok(migrationProblems([null]).length);
  assert.ok(migrationProblems([{ ...pattern, from: '' }]).length);
  assert.ok(migrationProblems([{ ...pattern, to: 1 }]).length);
  assert.ok(migrationProblems([{ ...pattern, note: null }]).length);
  assert.ok(migrationProblems([{ ...pattern, extra: true }]).length);
});
