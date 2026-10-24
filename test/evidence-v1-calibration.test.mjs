// Calibration expectations come from proposal section 5, not from observed tool output.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cases } from '../calibration/evidence-v1.mjs';
import { runCorpus } from '../calibration/run.mjs';
test('each new or changed check has a v1 defect and clean calibration case', () => {
  const ids = ['structure.public-interface', 'refactor.behavior-preserved', 'fix.reproduced', 'fix.regression-check', 'acceptance.AC1',
    'behavior.harness-holds', 'completeness.migrations-docs', 'completeness.no-stale-references', 'completeness.dependency-policy'];
  for (const id of ids) {
    assert.ok(cases.some((x) => x.defect && x.expected.checks[id] === 'FAIL'), id);
    assert.ok(cases.some((x) => !x.defect && x.expected.checks[id] === 'PASS'), id);
  }
  assert.ok(cases.every((x) => x.profileId === 'evidence-v1'));
});
test('v1 calibration cases match their independent expected checks', async () => {
  const run = await runCorpus(cases, { concurrency: 2 });
  assert.deepEqual(run.results.filter((x) => !x.passed).map((x) => [x.id, x.mismatches]), []);
  assert.ok(run.metricsByProfile['evidence-v1']);
});
