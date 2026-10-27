import assert from 'node:assert/strict';
import { test } from 'node:test';
import { gaps } from '../lib/overview-gaps.mjs';
import { project, outcome } from './oracle-fixtures.mjs';

test('per-stack skipped counts are included in verification uncertainty warnings', (t) => {
  const f = project(t, { 'src/style.css': '.button { color: red; }' });
  const { results, markdown } = outcome(f.verify(f.request()), 3);
  assert.deepEqual(results.completeness.find((x) => x.stack === 'CSS'), { stack: 'CSS', discovered: 1,
    supported: 0, parsed: 0, skipped: 1, malformed: 0, dynamicallyUnresolved: 0 });
  assert.equal(results.gaps.some((x) => x.key === 'completeness:CSS'), false);
  assert.ok(results.gaps.some((x) => x.key === 'completeness:unsupported' && /^Code-map does not analyze these files: 1 CSS, /.test(x.text)));
  assert.match(markdown, /does not analyze these files: 1 CSS/);
});

test('overview warnings retain all uncertain stack counts and omit complete and unsupported stacks', () => {
  const analysis = { files: [], completeness: [
    { stack: 'TypeScript', discovered: 4, supported: 4, parsed: 3, skipped: 1, malformed: 2, dynamicallyUnresolved: 3 },
    { stack: 'JSON', discovered: 1, supported: 1, parsed: 1, skipped: 0, malformed: 0, dynamicallyUnresolved: 0 },
    { stack: 'CSS', discovered: 2, supported: 0, parsed: 0, skipped: 2, malformed: 0, dynamicallyUnresolved: 0 },
    { stack: 'other', discovered: 5, supported: 0, parsed: 0, skipped: 5, malformed: 0, dynamicallyUnresolved: 0 }] };
  const warnings = gaps({ data: { analysis, sha: 'abc' } }).filter((x) => x.key.startsWith('completeness:'));
  assert.deepEqual(warnings.map((x) => x.text), [
    'Code-map does not analyze these files: 2 CSS, 5 other. They add no import or test evidence.',
    'TypeScript: 4 discovered, 4 supported, 3 parsed, 1 skipped, 2 malformed, 3 dynamically unresolved. Analysis evidence is incomplete.'
  ]);
  assert.equal(gaps({ data: { analysis: { files: [] }, sha: 'abc' } }).some((x) => x.key.startsWith('completeness:')), false);
});
