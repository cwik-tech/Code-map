// The calibration corpus: the test replays a fixed subset, with one seeded defect and one clean case for each check, four cases
// at a time. It fails when a result differs from the expected one. scripts/calibrate.mjs replays every case. A case marked as
// a known failure never fails the test, but a known failure that now matches does, so that its mark is removed.
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { availableParallelism, tmpdir } from 'node:os';
import { test } from 'node:test';
import { join } from 'node:path';
import { cases } from '../calibration/cases.mjs';
import { formatReport, metricsOf, runCorpus } from '../calibration/run.mjs';

const subset = ['arch-new-break', 'arch-clean', 'import-missing-file', 'import-clean', 'cycle-new', 'cycle-clean', 'consumer-left-behind', 'consumer-updated',
  'focused-test', 'focused-clean', 'weakened-deleted', 'weakened-clean', 'scope-outside', 'scope-clean', 'settings-edited', 'settings-clean',
  'behavior-new-failure', 'behavior-earlier-failure', 'head-run-nothing'];
const results = ['PASS', 'FAIL', 'UNKNOWN', 'NOT_APPLICABLE'], states = ['BLOCKED', 'INSUFFICIENT_EVIDENCE', 'REVIEW', 'READY'];
const named = (item) => Object.keys(item.expected.checks);

test('each case is complete, about half have a seeded defect, and the subset has a FAIL and a PASS case for each check', () => {
  assert.ok(cases.length >= 24, `the corpus has at least 24 cases, not ${cases.length}`);
  assert.equal(new Set(cases.map((item) => item.id)).size, cases.length, 'each case ID is unique');
  for (const item of cases) {
    assert.ok(item.id && item.name && typeof item.defect === 'boolean' && states.includes(item.expected?.readiness), `${item.id ?? '(no id)'} is complete`);
    assert.ok(named(item).length > 0 && Object.values(item.expected.checks).every((value) => results.includes(value)), `${item.id} names checks with valid results`);
    if (item.defect) assert.ok(Object.values(item.expected.checks).includes('FAIL'), `${item.id} has a seeded defect, so one check must fail`);
  }
  const share = cases.filter((item) => item.defect).length / cases.length;
  assert.ok(share >= 0.4 && share <= 0.6, `about half of the cases have a seeded defect, not ${Math.round(share * 100)}%`);
  const chosen = cases.filter((item) => subset.includes(item.id) || item.id.startsWith('bound-'));
  assert.equal(chosen.length, subset.length + 12, 'each original and bound-report subset ID is a case');
  for (const id of new Set(cases.filter((x) => x.profileId !== 'evidence-v1').flatMap(named))) {
    for (const want of ['FAIL', 'PASS']) assert.ok(chosen.some((item) => item.expected.checks[id] === want), `the subset has a case that expects ${want} for ${id}`);
  }
});

test('a fixed subset of the corpus gives the expected readiness and check results', async () => {
  const only = new Set([...subset, ...cases.filter((item) => item.knownFailure).map((item) => item.id)]);
  const run = await runCorpus(cases, { only, concurrency: Math.min(4, availableParallelism()) });
  const produced = new Set(run.results.flatMap((result) => Object.keys(result.checks)));
  for (const id of new Set(cases.filter((item) => !item.id.startsWith('bound-') && item.profileId !== 'evidence-v1').flatMap(named))) assert.ok(produced.has(id), `code-map verify gives the check ${id}, so the cases name a real check ID`);
  const unexpected = run.results.filter((result) => !result.passed && !result.knownFailure && !result.skipped);
  assert.deepEqual(unexpected.map((result) => `${result.id}: ${JSON.stringify(result.mismatches)}`), [], 'each case matches its expected results');
  assert.deepEqual(run.results.filter((result) => result.passed && result.knownFailure).map((result) => result.id), [], 'a known failure that now matches loses its mark');
});

test('a case that verify refuses is an error of that case, and its temporary folder is removed', async (t) => {
  const temporaryRoot = mkdtempSync(join(tmpdir(), 'calibration-cleanup-test-'));
  t.after(() => rmSync(temporaryRoot, { recursive: true, force: true }));
  const broken = { id: 'refused', name: 'refused', defect: false, base: { 'src/a.ts': 'export const a = 1;\n' }, head: { 'src/a.ts': 'export const a = 2;\n' },
    request: { profileId: 'no-such-profile' }, expected: { readiness: 'INSUFFICIENT_EVIDENCE', checks: { 'scope.allowed-paths': 'PASS' } } };
  const run = await runCorpus([broken], { temporaryRoot });
  assert.equal(run.results[0].passed, false);
  assert.match(run.results[0].error, /status 4/);
  assert.match(formatReport(run), /refused\s+no\s+-\s+-\s+ERROR/);
  assert.deepEqual(readdirSync(temporaryRoot), [], 'no owned calibration folder is left behind');
});

test('the report shows a known failure, keeps it out of the unexpected count, and counts it in the matrix', () => {
  const result = (id, defect, knownFailure, actual) => ({ id, name: id, defect, knownFailure, expected: { readiness: 'BLOCKED', checks: { 'x.check': defect ? 'FAIL' : 'PASS' } },
    readiness: 'BLOCKED', checks: { 'x.check': actual }, durationMs: 1000, error: null, passed: actual === (defect ? 'FAIL' : 'PASS'),
    mismatches: actual === (defect ? 'FAIL' : 'PASS') ? [] : [{ part: 'x.check', expected: defect ? 'FAIL' : 'PASS', actual }] });
  const results = [result('missed', true, true, 'PASS'), result('found', true, false, 'FAIL'), result('clean', false, false, 'PASS')];
  const run = { results, metrics: metricsOf(results), totalDurationMs: 3000 };
  assert.deepEqual(run.metrics['x.check'], { tp: 1, fp: 0, tn: 1, fn: 1, precision: 1, recall: 0.5 });
  const text = formatReport(run);
  assert.match(text, /missed\s+yes\s+BLOCKED\s+1\.0 s\s+known failure/);
  assert.match(text, /missed \(known failure\):\n {2}x\.check: expected FAIL, actual PASS/);
  assert.match(text, /x\.check\s+1\s+0\s+1\s+1\s+100%\s+50%/);
  assert.match(text, /3 cases \(2 with a seeded defect, 1 clean\): 2 match, 1 known failures, 0 unexpected differences/);
});

test('bound compiler and coverage cases cover both threshold outcomes', async () => {
  const selected = cases.filter((item) => item.id.startsWith('bound-'));
  assert.equal(selected.length, 12);
  const run = await runCorpus(selected, { concurrency: 4 });
  assert.deepEqual(run.results.filter((item) => !item.passed).map((item) => [item.id, item.mismatches]), []);
  const low = run.results.find((item) => item.id === 'bound-lcov-lines-defect');
  assert.equal(low.checks['vc.changed-lines-80'], 'FAIL');
  const high = run.results.find((item) => item.id === 'bound-lcov-lines-clean');
  assert.equal(high.checks['vc.changed-lines-80'], 'PASS');
});

test('worker cases skip explicitly without sandbox-exec and do not enter the confusion matrix', async () => {
  const item = { id: 'worker-example', name: 'worker example', worker: true, defect: true,
    expected: { readiness: 'BLOCKED', checks: { 'worker.check': 'FAIL' } } };
  const run = await runCorpus([item], { sandboxAvailable: false });
  assert.deepEqual(run.metrics, {});
  assert.equal(run.results[0].skipped, 'sandbox-exec is unavailable');
  assert.match(formatReport(run), /SKIP/);
  assert.match(formatReport(run), /sandbox-exec is unavailable/);
});

test('an unnamed coverage failure is a mismatch instead of a silent false positive', async () => {
  const source = cases.find((item) => item.id === 'bound-lcov-lines-defect');
  const item = { ...source, id: 'unnamed-coverage', expected: { readiness: 'INSUFFICIENT_EVIDENCE', checks: { 'coverage.head-run': 'PASS' } } };
  const run = await runCorpus([item]);
  assert.equal(run.results[0].passed, false);
  assert.deepEqual(run.results[0].mismatches, [{ part: 'vc.changed-lines-80', expected: 'not FAIL', actual: 'FAIL' }]);
});
