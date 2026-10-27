import assert from 'node:assert/strict';
import { test } from 'node:test';
import { repository } from './packages-fixture.mjs';

const layers = [{ name: 'ui', paths: ['src/ui/**'] }, { name: 'core', paths: ['src/core/**'] }];
const summaryOf = (f) => f.json(['inspect', '--summary', '--worktree', '--base', 'HEAD', '--store', f.store]);

test('revision policies evaluate both snapshots and retain an exact relaxed-edge witness', (t) => {
  const f = repository(t, {
    '.code-map.json': JSON.stringify({ roots: ['src'], layers }),
    'src/core/use.ts': 'import { view } from "../ui/view"; export const use = view;',
    'src/ui/view.ts': 'export const view = 1;',
  });
  f.put('.code-map.json', JSON.stringify({ roots: ['src'], layers: [...layers].reverse() }));
  const policy = summaryOf(f).comparison.policy;
  const witness = (items) => items.map(({ rule, from, to, lines }) => ({ rule, from, to, lines }));
  const expected = [{ rule: 'layer:core -> ui', from: 'src/core/use.ts', to: 'src/ui/view.ts', lines: [1] }];
  assert.equal(policy.state, 'CHANGED');
  assert.deepEqual(witness(policy.relaxed), expected);
  assert.deepEqual(witness(policy.evaluations.basePolicy.base.violations), expected);
  assert.deepEqual(witness(policy.evaluations.basePolicy.head.violations), expected);
  assert.deepEqual(policy.evaluations.headPolicy.base.violations, []);
  assert.deepEqual(policy.evaluations.headPolicy.head.violations, []);
});

test('a newly added cross-layer import has a NEW forbidden-edge finding against the base', (t) => {
  const f = repository(t, {
    '.code-map.json': JSON.stringify({ roots: ['src'], layers }),
    'src/core/use.ts': 'export const use = 1;', 'src/ui/view.ts': 'export const view = 1;',
  });
  f.put('src/core/use.ts', 'import { view } from "../ui/view"; export const use = view;');
  const summary = summaryOf(f);
  const finding = summary.findings.items.find((item) => item.ruleId === 'ARCH-RULE');
  assert.equal(summary.comparison.state, 'COMPARABLE');
  assert.equal(finding.baseline, 'NEW');
  assert.equal(finding.location.path, 'src/core/use.ts');
  assert.deepEqual(summary.comparison.policy.evaluations.basePolicy.base.violations, []);
  assert.deepEqual(summary.comparison.policy.evaluations.basePolicy.head.violations.map(({ from, to }) => [from, to]), [['src/core/use.ts', 'src/ui/view.ts']]);
});
