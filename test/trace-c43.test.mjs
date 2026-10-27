// Traceability for C43: the calibration replay tracks per-case and total latency.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatReport, metricsOf, bandMetricsOf, runCorpus } from '../calibration/run.mjs';
import { cases } from '../calibration/cases.mjs';
import { performance } from 'node:perf_hooks';
import { spawnSync } from 'node:child_process';
import { project } from './oracle-fixtures.mjs';
import { fileURLToPath } from 'node:url';

test('calibration tracks per-case and total latency in the report', () => {
  const result = { id: 'latency-case', name: 'latency case', defect: false, expected: { readiness: 'BLOCKED', checks: {} },
    readiness: 'BLOCKED', checks: {}, durationMs: 1000, error: null, passed: true, mismatches: [] };
  const run = { results: [result], metrics: metricsOf([result]), metricsByProfile: {}, totalDurationMs: 2500 };
  const text = formatReport(run);
  assert.match(text, /latency-case\s+no\s+BLOCKED\s+1\.0 s\s+ok/, 'the report shows the per-case duration');
  assert.match(text, /Total 2\.5 s\./, 'the report shows the total run duration');
});

test('calibration measures positive case and total latency while replaying an actual defect', async () => {
  const started = performance.now();
  const run = await runCorpus(cases, { only: new Set(['import-missing-file']) });
  const elapsed = performance.now() - started;
  assert.equal(run.results.length, 1);
  assert.equal(run.results[0].error, null);
  assert.equal(run.results[0].checks['structure.imports-resolve'], 'FAIL');
  assert.ok(run.results[0].durationMs > 0);
  assert.ok(run.totalDurationMs >= run.results[0].durationMs);
  assert.ok(elapsed >= run.totalDurationMs);
  assert.match(formatReport(run), /Total \d+\.\d s\./);
});

test('calibration compares expected category bands and preserves unassessed observations', async () => {
  const item = { ...cases.find((x) => x.id === 'import-missing-file') };
  item.expected = { ...item.expected, ratings: { structuralIntegrity: 5, behavioralConfidence: 5 } };
  const run = await runCorpus([item]);
  assert.equal(run.results[0].passed, false);
  assert.deepEqual(run.results[0].ratings?.behavioralConfidence, { state: 'UNASSESSED', value: null });
  assert.ok(run.results[0].mismatches.some((x) => x.part === 'ratings.structuralIntegrity' && x.expected === 5 && x.actual === 1));
  assert.ok(run.results[0].mismatches.some((x) => x.part === 'ratings.behavioralConfidence' && x.expected === 5 && x.actual === 'Unassessed'));
  assert.match(formatReport(run), /ratings.behavioralConfidence: expected 5, actual Unassessed/);
});

test('historical replay distinguishes new defects from their parent and observes the subsequent fix', (t) => {
  const f = project(t, { '.code-map.json': JSON.stringify({ rules: ['core -> ui'] }),
    'src/core/engine.ts': 'export const engine = 1;\n', 'src/ui/view.ts': 'export const view = 1;\n' });
  f.put('src/core/engine.ts', "import { view } from '../ui/view'; export const engine = view;\n");
  const introduced = f.commit('fix introduces a fixture defect');
  f.put('src/core/engine.ts', "import { view } from '../ui/view'; export const engine = view + 1;\n");
  const continued = f.commit('fix unrelated arithmetic while defect is pre-existing');
  f.put('src/core/engine.ts', 'export const engine = 2;\n');
  const fixed = f.commit('fix architecture incident');
  const output = spawnSync(process.execPath, [fileURLToPath(new URL('../scripts/replay.mjs', import.meta.url)),
    '--repo', f.root, '--limit', '3'], { encoding: 'utf8', timeout: 30000 });
  assert.equal(output.status, 0, output.stderr);
  const rows = output.stdout.trim().split('\n').slice(1).map((line) => line.split('\t'));
  assert.deepEqual(rows.map((row) => row[0]), [fixed, continued, introduced]);
  assert.deepEqual(rows.map((row) => row[1]), ['INSUFFICIENT_EVIDENCE', 'INSUFFICIENT_EVIDENCE', 'BLOCKED']);
  assert.equal(rows[0][2], '-');
  assert.equal(rows[1][2], '-');
  assert.match(rows[2][2], /structure\.architecture-rules/);
});

test('category agreement separates defects and clean cases and never passes an unassessed band', () => {
  const row = (defect, expected, state, value) => ({ defect, expected: { ratings: { structuralIntegrity: expected } },
    ratings: { structuralIntegrity: { state, value } }, error: null });
  const results = [row(true, 1, 'RATED', 1), row(true, 5, 'RATED', 1), row(false, 5, 'RATED', 5),
    row(false, 'Unassessed', 'UNASSESSED', null), row(false, 5, 'UNASSESSED', null), { ...row(false, 5, 'RATED', 5), error: 'run refused' },
    { ...row(true, 1, 'RATED', 1), skipped: 'unavailable worker' }];
  assert.deepEqual(bandMetricsOf(results), { structuralIntegrity: {
    defect: { total: 2, agreed: 1, mismatched: 1, unassessed: 0, unavailable: 0 },
    clean: { total: 4, agreed: 1, mismatched: 0, unassessed: 2, unavailable: 1 } } });
  const text = formatReport({ results: [], metrics: {}, bandMetrics: bandMetricsOf(results), totalDurationMs: 0 });
  assert.match(text, /structuralIntegrity\s+defect\s+2\s+1\s+1\s+0\s+0/);
  assert.match(text, /structuralIntegrity\s+clean\s+4\s+1\s+0\s+2\s+1/);
});

test('calibration rejects an expected category band outside its declared vocabulary', async () => {
  const source = cases.find((x) => x.id === 'import-clean');
  const run = await runCorpus([{ ...source, expected: { ...source.expected, ratings: { structuralIntegrity: 6 } } }]);
  assert.equal(run.results[0].passed, false);
  assert.match(run.results[0].error, /Invalid expected rating structuralIntegrity: 6/);
});
