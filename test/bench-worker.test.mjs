// Bench runs use the real restricted worker and the public CLI.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { authorize, project, sandboxed, run } from './worker-fixtures.mjs';
import { loadRun } from '../lib/worker/runs.mjs';
import { loadConfig } from '../lib/project.mjs';
import { analysisInputs } from '../lib/inputs.mjs';
import { loadReports } from '../lib/verify-reports.mjs';

const cli = fileURLToPath(new URL('../bin/code-map.mjs', import.meta.url));
test('bench CLI keeps an isolated bound report from repeated runs in one workspace', sandboxed, (t) => {
  const f = project(t);
  f.put('counter.mjs', `import { existsSync, readFileSync, writeFileSync } from 'node:fs';
const count = existsSync('count') ? Number(readFileSync('count', 'utf8')) : 0;
writeFileSync('count', String(count + 1));
console.log(count + 1);
`);
  const command = [process.execPath, 'counter.mjs'], authorization = authorize(f, command);
  const result = spawnSync(process.execPath, [cli, 'bench', '--store', f.store, '--authorization', authorization,
    '--runs', '3', '--warmup', '1', '--worktree', '--', ...command], { cwd: f.root, encoding: 'utf8', timeout: 30000 });
  assert.equal(result.status, 0, result.stderr);
  const summary = JSON.parse(result.stdout), stored = loadRun(f.store, summary.runId, f.root);
  const report = JSON.parse(stored.bytes);
  assert.equal(stored.manifest.environment.policy, 'isolated');
  assert.equal(stored.manifest.artifacts[0].kind, 'bench');
  assert.equal(report.samples.length, 3);
  assert.equal(report.warmup, 1);
  assert.equal(report.warmupSamples.length, 1);
  assert.equal(stored.record.output.stdoutBytes, 8);
  assert.equal(stored.record.output.keptBytes, 8);
  assert.ok(report.samples.every((n) => Number.isFinite(n) && n > 0));
  assert.ok(report.machine.cpuCount > 0);
  assert.equal(report.loadBefore.length, 3);
  assert.equal(readFileSync(summary.files.stdout, 'utf8'), '1\n2\n3\n4\n');
  const config = loadConfig(f.root), inputs = analysisInputs(f.root, config, { worktree: true }, null);
  const side = { inputs, sha: inputs.sha, analysis: {} };
  const loaded = loadReports(f.root, [{ run: summary.runId }], { head: side, base: side }, undefined, f.store);
  assert.equal(loaded.bench.head.length, 1);
  assert.equal(loaded.reports.head.length, 0);
  assert.equal(loaded.reports.ineligible.length, 0);
});

test('a failed benchmark command keeps no successful timing artifact', sandboxed, async (t) => {
  const f = project(t), result = await run(f, [process.execPath, '-e', 'process.exit(2)'], { bench: { runs: 2, warmup: 0 } });
  assert.equal(result.exitCode, 1);
  assert.equal(result.record.artifact, null);
});

test('bench validates run counts and refuses an unauthorized command', (t) => {
  const f = project(t);
  const result = spawnSync(process.execPath, [cli, 'bench', '--runs', '0', '--warmup', '0', '--', process.execPath, '-e', ''],
    { cwd: f.root, encoding: 'utf8', timeout: 10000 });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /runs/);
  const refused = spawnSync(process.execPath, [cli, 'bench', '--runs', '2', '--warmup', '0', '--', process.execPath, '-e', ''],
    { cwd: f.root, encoding: 'utf8', timeout: 10000 });
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /authorization/);
});

test('warmups and measurements share one aggregate output budget', sandboxed, async (t) => {
  const f = project(t), command = [process.execPath, '-e', "process.stdout.write('x'.repeat(600000))"];
  const result = await run(f, command, { bench: { runs: 1, warmup: 1 }, budgets: { outputMegabytes: 1 } });
  assert.equal(result.exitCode, 1);
  assert.equal(result.record.stoppedBy, 'outputMegabytes');
  assert.equal(result.record.artifact, null);
  assert.equal(readFileSync(result.paths.stdout).length, 1048576);
});


test('output accounting includes every repetition', sandboxed, async (t) => {
  const f = project(t), result = await run(f, [process.execPath, '-e', "process.stdout.write('ab')"], { bench: { runs: 2, warmup: 0 } });
  assert.equal(result.record.output.stdoutBytes, 4);
  assert.equal(result.record.output.keptBytes, 4);
});

test('wall-clock exhaustion between repetitions keeps a stopped record', sandboxed, async (t) => {
  const f = project(t), result = await run(f, [process.execPath, '-e', ''],
    { bench: { runs: 2, warmup: 0 }, budgets: { wallClockSeconds: 1 } }, { graceMs: 1100 });
  assert.equal(result.exitCode, 1);
  assert.equal(result.record.stoppedBy, 'wallClockSeconds');
  assert.equal(result.record.artifact, null);
});
