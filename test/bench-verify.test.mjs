// Public CLI binding and verification of fixed benchmark artifacts.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { project } from './worker-fixtures.mjs';
import { timingStatistics } from '../lib/bench-report.mjs';

const cli = fileURLToPath(new URL('../bin/code-map.mjs', import.meta.url));
test('verify compares bound timings as information and rejects stale or malformed reports', (t) => {
  const f = project(t), command = ['node', 'probe.mjs'];
  f.put('.code-map.json', JSON.stringify({ timings: { minimumChangePercent: 40 } }));
  f.git('add', '.'); f.git('commit', '-qm', 'timing policy');
  const base = f.git('rev-parse', 'HEAD');
  const invoke = (args) => spawnSync(process.execPath, [cli, ...args], { cwd: f.root, encoding: 'utf8', timeout: 30000 });
  const bind = (name, samples) => {
    const artifact = `reports/${name}.json`, manifest = `reports/${name}.manifest.json`;
    f.put(artifact, JSON.stringify({ reportType: 'code-map-bench', schemaVersion: 1, command, warmup: 1, warmupSamples: [1000],
      samples, statistics: timingStatistics(samples), machine: { id: 'a'.repeat(64), cpuModel: 'test', cpuCount: 4,
        platform: process.platform, architecture: process.arch, node: process.versions.node }, loadBefore: [1, 1, 1], loadAfter: [1, 1, 1] }));
    const result = invoke(['manifest', '--kind', 'bench', '--artifact', artifact, '--exit-status', '0', '--out', manifest, '--', ...command]);
    assert.equal(result.status, 0, result.stderr);
    return { artifact, manifest };
  };
  const b = bind('base', [99, 100, 101]);
  f.put('src/sum.mjs', 'export function sum(a, b) { return a - b; }\n');
  const h = bind('head', [129, 130, 131]);
  const verify = () => {
    const request = { requestType: 'code-map-verification-request', schemaVersion: 1, base, head: 'worktree', intent: 'Measure timings.',
      acceptanceCriteria: [], allowedPaths: ['src/**'], changeType: 'other', profileId: 'static-baseline-v0', ratingRulesVersion: 'ratings-v0',
      reportInputs: [b, h], execution: { enabled: false, authorization: null,
        budgets: { wallClockSeconds: 30, memoryMegabytes: 512, outputMegabytes: 8, concurrency: 1 } } };
    const requestFile = join(f.work, 'request.json');
    writeFileSync(requestFile, JSON.stringify(request));
    const result = invoke(['verify', '--request', requestFile, '--store', f.store, '--out-dir', join(f.work, 'out')]);
    assert.equal(result.status, 3, result.stderr);
    const summary = JSON.parse(result.stdout);
    return { results: JSON.parse(readFileSync(summary.files.results, 'utf8')), markdown: readFileSync(summary.files.report, 'utf8') };
  };
  const { results, markdown } = verify();
  assert.equal(results.bench.state, 'COMPARED');
  assert.equal(results.bench.changePercent, 30);
  assert.equal(results.bench.outsideNoise, false, 'configured 40 percent minimum applies');
  assert.equal(results.bench.minimumChangePercent, 40);
  assert.equal(results.executions[0].kind, 'bench');
  assert.equal(results.executions[0].attestation, 'self-attested');
  assert.equal(results.obligations.some((item) => item.id.includes('bench')), false);
  assert.match(markdown, /Controlled timings/);
  assert.match(markdown, /30.00%/);
  f.put(h.artifact, '{}');
  assert.equal(verify().results.executions[1].eligible, false);
  const rebound = invoke(['manifest', '--kind', 'bench', '--artifact', h.artifact, '--exit-status', '0', '--out', h.manifest, '--', ...command]);
  assert.equal(rebound.status, 0, rebound.stderr);
  assert.equal(verify().results.bench.state, 'UNKNOWN');
});
