// Verification Coverage of static-baseline-v0 with the line coverage of the changed code from a bound LCOV report:
// 80% of the changed lines for 3 of 5, 70% of the changed branches for 4 of 5, and a changed file that the report does not measure.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { changedCoverage, lcovCoverage } from '../lib/changed-coverage.mjs';
import { evaluate, modified, passing } from './profile-fixtures.mjs';

/** The measure of 100 changed lines of src/a.ts with `lines` covered, and 10 branches on them with `branches` taken. */
function measure(lines, branches, changed = new Map([['src/a.ts', Array.from({ length: 100 }, (_, index) => index + 1)]])) {
  const text = ['SF:src/a.ts', ...Array.from({ length: 100 }, (_, index) => `DA:${index + 1},${index < lines ? 1 : 0}`),
    ...Array.from({ length: 10 }, (_, index) => `BRDA:${index + 1},0,${index},${index < branches ? 2 : '-'}`), 'end_of_record', ''].join('\n');
  return changedCoverage(changed, [{ artifact: 'coverage/lcov.info', ...lcovCoverage(text, { repository: '/repo' }) }]);
}
const rated = (coverage) => evaluate({ ...passing, coverage }).ratings.verificationCoverage;

test('80% of the changed lines lets level 3 pass, and 79% does not meet the condition', () => {
  const at80 = rated(measure(80, 0)), at79 = rated(measure(79, 10));
  assert.deepEqual([at80.state, at80.value], ['RATED', 3]);
  assert.ok(at80.predicates.met.includes('vc.changed-lines-80'));
  assert.deepEqual([at79.value, at79.predicates.unmet.includes('vc.changed-lines-80')], [2, true]);
});

test('70% of the changed branches lets level 4 pass, and 69% stops at 3', () => {
  assert.equal(rated(measure(100, 7)).value, 4);
  const branches = Array.from({ length: 100 }, (_, index) => index + 1);
  const text = ['SF:src/a.ts', ...branches.map((line) => `DA:${line},1`), ...branches.map((line) => `BRDA:${line},0,0,${line <= 69 ? 1 : '-'}`), 'end_of_record'].join('\n');
  const at69 = rated(changedCoverage(new Map([['src/a.ts', branches]]), [{ artifact: 'coverage/lcov.info', ...lcovCoverage(text, { repository: '/repo' }) }]));
  assert.deepEqual([at69.value, at69.predicates.unmet], [3, ['vc.changed-branches-70']]);
});

test('a changed code file without an SF record keeps both coverage conditions unmet, and names the file and the report as evidence', () => {
  const coverage = measure(100, 10, new Map([['src/a.ts', Array.from({ length: 100 }, (_, index) => index + 1)], ['src/b.ts', [3]]]));
  const output = evaluate({ ...passing, change: modified('src/a.ts', 'src/b.ts'), coverage }), rating = output.ratings.verificationCoverage;
  assert.deepEqual([rating.value, rating.predicates.unmet], [2, ['vc.changed-lines-80', 'vc.changed-branches-70']]);
  const predicate = output.categories.verificationCoverage.bands[3].find((item) => item.id === 'vc.changed-lines-80');
  assert.deepEqual(predicate.evidenceIds, ['report:coverage/lcov.info', 'path:src/b.ts']);
});

test('without a bound coverage report, Verification Coverage stays Unassessed as before, and the missing evidence is a line-coverage report', () => {
  const rating = rated(null);
  assert.equal(rating.state, 'UNASSESSED');
  assert.deepEqual(rating.missingEvidence, ['A bound line-coverage report of the head']);
  assert.equal(rated(measure(100, 10)).minimumEvidenceMet, true);
});

test('a change without a changed executable line gives no line-coverage result, so level 3 stays open', () => {
  const coverage = measure(100, 10, new Map([['src/a.ts', [500]]]));
  assert.deepEqual(coverage.changedLines, { covered: 0, total: 0 });
  const rating = rated(coverage);
  assert.deepEqual([rating.value, rating.predicates.unknown], [2, ['vc.changed-lines-80', 'vc.changed-branches-70']]);
});
