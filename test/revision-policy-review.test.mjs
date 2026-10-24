// Review regression tests use a real Git settings blob and small stored analysis records.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { revisionPolicy } from '../lib/revision-policy.mjs';
import { comparisonOf } from '../lib/inspect.mjs';
import { migrationUses } from '../lib/migrations.mjs';

function fixture(t, settings) {
  const repository = mkdtempSync(join(tmpdir(), 'code-map-policy-review-'));
  t.after(() => rmSync(repository, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', ['-C', repository, '-c', 'user.name=test', '-c', 'user.email=test@local', ...args], { encoding: 'utf8' }).trim();
  const put = (value) => writeFileSync(join(repository, '.code-map.json'), JSON.stringify(value));
  put(settings); git('init', '-q'); git('add', '.'); git('commit', '-qm', 'base');
  const sha = git('rev-parse', 'HEAD');
  const files = [{ path: 'src/core/use.ts', imports: [{ target: 'src/ui/view.ts', line: 1 }] }, { path: 'src/ui/view.ts', imports: [] }];
  const stored = (worktree, commit = sha) => ({ id: 'fixture', inputs: { repository, selector: { worktree }, config: 'same' }, findings: [],
    data: { sha: commit, roots: ['src'], analysis: { files } } });
  return { repository, put, git, base: stored(false), head: stored(true), stored };
}

test('equivalent rule whitespace does not report relaxed edges', (t) => {
  const p = fixture(t, { rules: ['core -> ui'] });
  p.put({ rules: ['core  ->  ui'] });
  assert.deepEqual(revisionPolicy(p.head, p.base).relaxed, []);
});

test('another restriction on the same edge prevents a false relaxation', (t) => {
  const p = fixture(t, { rules: ['core -> *'] });
  p.put({ rules: ['core -> ui'] });
  assert.deepEqual(revisionPolicy(p.head, p.base).relaxed, []);
});

test('a saved working-tree comparison refuses policy binding after settings change', (t) => {
  const p = fixture(t, { rules: ['core -> ui'] });
  p.put({ rules: [] });
  const result = comparisonOf(p.head, p.base, { state: 'stale', changed: ['config'] });
  assert.equal(result.policy.state, 'UNKNOWN');
  assert.match(result.policy.reason, /stale/);
});

test('a committed head reads its own policy despite working-folder drift', (t) => {
  const p = fixture(t, { rules: ['core -> ui'] });
  p.put({ rules: [] }); p.git('add', '.'); p.git('commit', '-qm', 'relax');
  const head = p.stored(false, p.git('rev-parse', 'HEAD'));
  p.put({ rules: ['ui -> core'] });
  const result = revisionPolicy(head, p.base);
  assert.deepEqual(result.head.rules, []);
  assert.deepEqual(result.rules.removed, ['core -> ui']);
  assert.equal(result.evaluations.basePolicy.head.violations.length, 1);
});

test('missing and malformed historical settings have distinct policy states', (t) => {
  const p = fixture(t, { rules: ['core -> ui'] });
  p.git('rm', '.code-map.json'); p.git('commit', '-qm', 'remove settings');
  const missing = p.stored(false, p.git('rev-parse', 'HEAD'));
  assert.equal(revisionPolicy(missing, missing).state, 'UNCHANGED');
  writeFileSync(join(p.repository, '.code-map.json'), '{bad');
  p.git('add', '.'); p.git('commit', '-qm', 'malformed settings');
  assert.equal(revisionPolicy(p.stored(false, p.git('rev-parse', 'HEAD')), missing).state, 'UNKNOWN');
});

test('namespace and import-equals local names count as imported migration names', () => {
  const uses = migrationUses(new Map([['src/use.ts', "import * as old from 'pkg';\nimport old = require('pkg');\n"]]),
    [{ from: 'old', to: 'next', note: 'Replace old.' }]);
  assert.deepEqual(uses.map((item) => [item.kind, item.line]), [['import-name', 1], ['import-name', 2]]);
});

test('multiple imports of one target produce one policy witness with all import lines', (t) => {
  const p = fixture(t, { rules: ['core -> ui'] });
  p.head.data.analysis.files[0].imports.push({ target: 'src/ui/view.ts', line: 3 });
  const violations = revisionPolicy(p.head, p.base).evaluations.basePolicy.head.violations;
  assert.equal(violations.length, 1);
  assert.deepEqual(violations[0].lines, [1, 3]);
});

test('re-exports and import types retain migration path uses', () => {
  const uses = migrationUses(new Map([['src/use.ts', "export { value } from 'old';\ntype Value = import('old').Value;\n"]]),
    [{ from: 'old', to: 'next', note: 'Replace old.' }]);
  assert.deepEqual(uses.map((item) => [item.kind, item.line]), [['import-path', 1], ['import-path', 2]]);
});

test('layer order changes report relaxed forbidden pairs even without an import witness', (t) => {
  const layers = [{ name: 'ui', paths: ['src/ui/**'] }, { name: 'core', paths: ['src/core/**'] }];
  const p = fixture(t, { layers });
  p.put({ layers: [...layers].reverse() });
  p.base.data.analysis.files = []; p.head.data.analysis.files = [];
  const policy = revisionPolicy(p.head, p.base);
  assert.deepEqual(policy.layers.reordered, ['core', 'ui']);
  assert.deepEqual(policy.layers.relaxed, ['layer:core -> ui']);
});


for (const ownership of [{ forbidCrossOwnerImports: false },
  { forbidCrossOwnerImports: true, allowed: [{ from: '@core', to: '@ui' }] }]) {
  test(`ownership relaxation retains base witnesses: ${JSON.stringify(ownership)}`, (t) => {
    const p = fixture(t, { ownership: { forbidCrossOwnerImports: true } });
    writeFileSync(join(p.repository, 'CODEOWNERS'), '/src/core/ @core\n/src/ui/ @ui\n');
    p.git('add', '.'); p.git('commit', '-qm', 'owners');
    const base = p.stored(false, p.git('rev-parse', 'HEAD'));
    base.data.analysis.files = [{ path: 'src/core/use.ts', imports: [] }, { path: 'src/ui/view.ts', imports: [] }];
    p.put({ ownership });
    const result = revisionPolicy(p.head, base);
    assert.equal(result.state, 'CHANGED');
    assert.equal(result.relaxed[0].rule, 'OWNER-CROSS-IMPORT');
    assert.equal(result.evaluations.basePolicy.head.ownership.violations.length, 1);
    assert.equal(result.evaluations.headPolicy.head.ownership.violations.length, 0);
    assert.equal(result.evaluations.basePolicy.base.ownership.violations.length, 0);
  });
}


test('revision ownership does not follow a symlinked CODEOWNERS folder', (t) => {
  const p = fixture(t, { ownership: { forbidCrossOwnerImports: true } });
  const outside = mkdtempSync(join(tmpdir(), 'code-map-owner-outside-'));
  t.after(() => rmSync(outside, { recursive: true, force: true }));
  writeFileSync(join(outside, 'CODEOWNERS'), '* @outside\n');
  symlinkSync(outside, join(p.repository, '.github'));
  const result = revisionPolicy(p.head, p.base);
  assert.equal(result.evaluations.basePolicy.head.ownership.state, 'UNKNOWN');
  assert.deepEqual(result.evaluations.basePolicy.head.ownership.owners, []);
});
