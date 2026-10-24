// Human label fixtures use a generated repository, never a real labeled case.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { project } from './oracle-fixtures.mjs';
import { compareLabels, validateLabel } from '../calibration/real-labels.mjs';
const script = fileURLToPath(new URL('../scripts/replay.mjs', import.meta.url));
function fixture(t) {
  const f = project(t);
  f.put('src/login.ts', "import { missing } from './missing'; export const login = missing;\n");
  const commit = f.commit('fix fixture'), labels = join(f.work, 'labels'); mkdirSync(labels);
  const value = { labelVersion: 1, repository: f.root, commit, labeledBy: 'Fixture reviewer',
    request: { base: 'base', intent: 'Check imports.', changeType: 'other', allowedPaths: ['**'], acceptanceCriteria: [] },
    expected: { 'structure.imports-resolve': 'FAIL', 'completeness.no-focused-test': 'PASS' } };
  const run = () => spawnSync(process.execPath, [script, '--labels', labels], { encoding: 'utf8', timeout: 30000 });
  return { ...f, labels, value, run };
}
test('labeled replay compares only labeled checks and preserves the repository', (t) => {
  const f = fixture(t), before = f.git('status', '--porcelain');
  writeFileSync(join(f.labels, 'fixture.json'), JSON.stringify(f.value));
  const output = f.run(); assert.equal(output.status, 0, output.stderr);
  const report = JSON.parse(output.stdout);
  assert.deepEqual(report.matrix, { TP: 1, FP: 0, TN: 1, FN: 0 });
  assert.equal(report.cases[0].labeledBy, 'Fixture reviewer');
  assert.equal(report.cases[0].mismatches.length, 0);
  assert.equal(f.git('status', '--porcelain'), before);
  f.value.expected['structure.imports-resolve'] = 'PASS';
  writeFileSync(join(f.labels, 'fixture.json'), JSON.stringify(f.value));
  const wrong = f.run(); assert.equal(wrong.status, 1, wrong.stderr);
  assert.deepEqual(JSON.parse(wrong.stdout).matrix, { TP: 0, FP: 1, TN: 1, FN: 0 });
});
test('labeled replay rejects missing people, mutable commits and execution requests', (t) => {
  const f = fixture(t);
  writeFileSync(join(f.labels, 'fixture.json'), JSON.stringify({ ...f.value, labeledBy: '', commit: 'HEAD', request: { ...f.value.request, execution: { enabled: true } } }));
  const output = f.run(); assert.equal(output.status, 1);
  assert.match(output.stderr, /label|commit|execution/i);
});
test('exact UNKNOWN mismatches remain visible and missing checks never become true negatives', () => {
  const compared = compareLabels({ a: 'PASS', b: 'FAIL', c: 'PASS', d: 'FAIL' }, [{ id: 'a', result: 'UNKNOWN' }, { id: 'b', result: 'PASS' }]);
  assert.deepEqual(compared.matrix, { TP: 0, FP: 0, TN: 1, FN: 2 });
  assert.deepEqual(compared.mismatches.map((x) => x.actual), ['UNKNOWN', 'PASS', null, null]);
});
for (const [name, fields] of [['missing person', { labeledBy: '' }], ['mutable commit', { commit: 'HEAD' }],
  ['execution', { request: { execution: { enabled: true } } }], ['other rule set', { request: { profileId: 'evidence-v1' } }],
  ['unknown result', { expected: { a: 'OK' } }]]) test(`labels reject ${name}`, () => {
  const value = { labelVersion: 1, repository: '/fixture', commit: 'a'.repeat(40), labeledBy: 'Fixture reviewer',
    request: { base: 'base', intent: 'Check.', changeType: 'other', allowedPaths: ['**'], acceptanceCriteria: [] }, expected: { a: 'PASS' } };
  assert.throws(() => validateLabel({ ...value, ...fields }), /Invalid label/);
});
