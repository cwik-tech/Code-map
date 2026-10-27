import assert from 'node:assert/strict';
import { test } from 'node:test';
import { pytestBenchmarkInformation, comparePytestBenchmarks } from '../lib/python/benchmark.mjs';
const sha = 'a'.repeat(40);
const run = { source: { sha, worktreeDigest: null }, exitStatus: 0, discovery: { filters: [] }, tools: [{ name: 'pytest', version: '8' }], environment: { policy: 'self-attested' } };
const entry = (fullname, median = 1) => ({ fullname, group: null, params: null, stats: { min: median, max: median, mean: median, median, stddev: 0, iqr: 0, rounds: 5, iterations: 1, ops: 1 / median } });
const report = (benchmarks = [entry('test_speed')], extra = {}) => ({ machine_info: { node: 'fixture', system: 'FixtureOS', python_version: '3.12' }, commit_info: { id: sha, dirty: false }, version: '5.1.0', benchmarks, ...extra });
const parse = (v, manifest = run) => pytestBenchmarkInformation(JSON.stringify(v), manifest);

test('pytest benchmark validates reports and refuses malformed nonfinite oversized or wrong revision evidence', () => {
  assert.equal(parse(report()).ok, true);
  assert.equal(parse(report([{ ...entry('broken'), stats: {} }])).ok, false);
  assert.equal(pytestBenchmarkInformation(JSON.stringify(report()).replace('"mean":1', '"mean":1e999'), run).ok, false);
  assert.equal(parse(report(undefined, { commit_info: { id: 'b'.repeat(40), dirty: false } })).ok, false);
  assert.equal(parse(report([entry('same'), entry('same')])).ok, false);
  assert.equal(pytestBenchmarkInformation(' '.repeat(16 * 1024 * 1024 + 1), run).ok, false);
  assert.equal(parse(report(), { ...run, exitStatus: 1 }).ok, false);
});

test('pytest benchmark compares fullnames medians noise added removed and machine tool drift', () => {
  const base = parse(report([entry('changed'), entry('stable'), entry('removed')])).report;
  const head = parse(report([entry('changed', 2), entry('stable'), entry('added')])).report;
  const compared = comparePytestBenchmarks({ base: [base], head: [head] });
  assert.equal(compared.state, 'COMPARED');
  assert.deepEqual(compared.entries.map((e) => [e.fullname, e.state]), [['added', 'ADDED'], ['changed', 'CHANGED'], ['removed', 'REMOVED'], ['stable', 'STABLE']]);
  assert.equal(compared.entries[1].changePercent, 100);
  assert.equal(comparePytestBenchmarks({ base: [base], head: [{ ...head, machine_info: { node: 'different' } }] }).state, 'UNKNOWN');
  assert.equal(comparePytestBenchmarks({ base: [base], head: [{ ...head, version: '6' }] }).state, 'UNKNOWN');
  assert.equal(comparePytestBenchmarks({ base: [base], head: [{ ...head, run: {} }] }).state, 'UNKNOWN');
  const noisy = parse(report([{ ...entry('changed', 2), stats: { ...entry('changed', 2).stats, min: 1, max: 3, stddev: 1, iqr: 2 } }])).report;
  assert.equal(comparePytestBenchmarks({ base: [base], head: [noisy] }).entries.find((e) => e.fullname === 'changed').state, 'STABLE');
});

test('pytest benchmark binds through manifests and stays outside test evidence', async (t) => {
  const { fixture } = await import('./python-fixtures.mjs');
  const { mkdirSync, writeFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  const { execFileSync } = await import('node:child_process');
  const { buildManifest } = await import('../lib/manifest.mjs');
  const { analysisInputs } = await import('../lib/inputs.mjs');
  const { loadReports } = await import('../lib/verify-reports.mjs');
  const { defaults } = await import('../lib/project.mjs');
  const root = fixture(t, { '.gitignore': 'reports/\n', 'widget.py': 'pass\n' });
  const revision = execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  mkdirSync(join(root, 'reports'));
  writeFileSync(join(root, 'reports/bench.json'), JSON.stringify(report(undefined, { commit_info: { id: revision, dirty: false } })));
  const manifest = buildManifest(root, defaults, { artifact: 'reports/bench.json', kind: 'pytest-benchmark-json', exitStatus: '0', command: ['pytest', '--benchmark-json=reports/bench.json'] });
  writeFileSync(join(root, 'reports/bench.manifest.json'), JSON.stringify(manifest));
  const inputs = analysisInputs(root, defaults, { worktree: true }, null), side = { inputs, sha: inputs.sha, analysis: { tests: { testFiles: [] } } };
  const loaded = loadReports(root, [{ artifact: 'reports/bench.json', manifest: 'reports/bench.manifest.json' }], { head: side, base: side }, undefined, join(root, 'reports/store'));
  assert.equal(loaded.executions[0].binding, 'BOUND');
  assert.equal(loaded.executions[0].eligible, true);
  assert.equal(loaded.pythonBench.head.length, 1);
  assert.equal(loaded.reports.head.length, 0);
});

test('pytest benchmark comparisons reject command drift except artifact output paths', () => {
  const base = parse(report(), { ...run, command: ['pytest', '--benchmark-json=base.json'], workingDirectory: '.' }).report;
  const head = parse(report(), { ...run, command: ['pytest', '--benchmark-json', 'head.json'], workingDirectory: '.' }).report;
  assert.equal(comparePytestBenchmarks({ base: [base], head: [head] }).state, 'COMPARED');
  const changed = parse(report(), { ...run, command: ['python', '-O', '-m', 'pytest', '--benchmark-json=head.json'], workingDirectory: '.' }).report;
  assert.equal(comparePytestBenchmarks({ base: [base], head: [changed] }).state, 'UNKNOWN');
  const moved = parse(report(), { ...run, command: ['pytest', '--benchmark-json=head.json'], workingDirectory: 'other' }).report;
  assert.equal(comparePytestBenchmarks({ base: [base], head: [moved] }).state, 'UNKNOWN');
});
