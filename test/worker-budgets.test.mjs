// The budgets of a run in the restricted worker: the wall clock, the output, the sampled memory and the concurrency. The
// record names the budget that stopped a run. A stopped run keeps no artifact and no manifest.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { entries, project, run, sandboxed } from './worker-fixtures.mjs';

const node = process.execPath;

test('the wall-clock budget stops the whole process group, also a child process, and the record names the budget', sandboxed, async (t) => {
  const fixture = project(t), started = Date.now();
  const script = 'require("child_process").spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "inherit" }); setInterval(() => {}, 1000)';
  const result = await run(fixture, [node, '-e', script], { budgets: { wallClockSeconds: 1 }, kind: 'junit', artifact: 'reports/junit.xml' });
  assert.equal(result.record.stoppedBy, 'wallClockSeconds');
  assert.deepEqual([result.record.exitStatus, result.record.signal], [null, 'SIGTERM']);
  assert.ok(Date.now() - started < 20000, 'the run did not wait for the child process');
  assert.equal(result.exitCode, 1);
  assert.deepEqual([result.record.artifact, result.paths.manifest], [null, null], 'a stopped run keeps no artifact');
  assert.match(result.record.problems.join(' '), /wall-clock budget/);
});

test('a process that ignores SIGTERM is stopped with SIGKILL after the grace period', sandboxed, async (t) => {
  const fixture = project(t);
  const result = await run(fixture, [node, '-e', 'process.on("SIGTERM", () => {}); setInterval(() => {}, 1000)'], { budgets: { wallClockSeconds: 1 } });
  assert.deepEqual([result.record.stoppedBy, result.record.signal], ['wallClockSeconds', 'SIGKILL']);
});

test('the output budget keeps at most the budget of standard output and standard error, then stops the run', sandboxed, async (t) => {
  const fixture = project(t);
  const script = 'process.stderr.write("e".repeat(1000)); const chunk = "x".repeat(65536); let count = 0; '
    + 'const pump = () => { while (count++ < 64) if (!process.stdout.write(chunk)) return process.stdout.once("drain", pump); }; pump(); setInterval(() => {}, 1000)';
  const result = await run(fixture, [node, '-e', script], { budgets: { outputMegabytes: 1 } });
  assert.equal(result.record.stoppedBy, 'outputMegabytes');
  assert.ok(result.record.output.keptBytes <= 1024 * 1024, JSON.stringify(result.record.output));
  assert.equal(statSync(result.paths.stdout).size + statSync(result.paths.stderr).size, result.record.output.keptBytes);
  assert.equal(result.record.output.truncated, true);
});

test('the memory budget is a sampled limit on the resident memory of the run, and the record says so', sandboxed, async (t) => {
  const fixture = project(t);
  const script = 'const kept = []; setInterval(() => kept.push(Buffer.alloc(32 * 1024 * 1024, 1)), 20)';
  const result = await run(fixture, [node, '-e', script], { budgets: { memoryMegabytes: 200, wallClockSeconds: 30 } });
  assert.equal(result.record.stoppedBy, 'memoryMegabytes');
  assert.ok(result.record.memory.peakMegabytes > 200, JSON.stringify(result.record.memory));
  assert.equal(result.record.memory.limit, 'sampled');
  assert.ok(result.record.memory.intervalMs > 0);
});

test('the concurrency budget refuses a run while other runs hold all slots, and the refused run leaves nothing behind', sandboxed, async (t) => {
  const fixture = project(t), slots = join(fixture.store, 'slots');
  mkdirSync(slots, { recursive: true, mode: 0o700 });
  writeFileSync(join(slots, 'R-20261022T000000Z-0000abcd.json'), JSON.stringify({ pid: process.pid, runId: 'R-20261022T000000Z-0000abcd' }), { mode: 0o600 });
  await assert.rejects(run(fixture, [node, '-e', '0'], { budgets: { concurrency: 1 } }), /1 other run is active, and the concurrency budget allows 1/);
  assert.deepEqual([entries(fixture.store, 'workspaces'), entries(fixture.store, 'runs'), entries(fixture.store, 'slots')], [[], [], ['R-20261022T000000Z-0000abcd.json']]);
  const second = await run(fixture, [node, '-e', '0'], { budgets: { concurrency: 2 } });
  assert.equal(second.record.exitStatus, 0);
});

test('a detached descendant that ignores SIGTERM is gone before the worker returns', sandboxed, async (t) => {
  const fixture = project(t);
  const childCode = 'process.on("SIGTERM", () => {}); process.send("ready"); setInterval(() => {}, 1000)';
  const script = `const child = require('child_process').spawn(process.execPath, ['-e', ${JSON.stringify(childCode)}], { detached: true, stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
    child.on('message', () => console.log(child.pid)); setInterval(() => {}, 1000)`;
  const result = await run(fixture, [node, '-e', script], { budgets: { wallClockSeconds: 2 } }, { sampleMs: 20 });
  const pid = Number(readFileSync(result.paths.stdout, 'utf8').trim());
  t.after(() => { try { process.kill(pid, 'SIGKILL'); } catch { /* the worker stopped it */ } });
  assert.ok(Number.isInteger(pid) && pid > 1, 'the child reported its PID before the budget stopped the run');
  const status = spawnSync('/bin/ps', ['-p', String(pid), '-o', 'stat='], { encoding: 'utf8' }).stdout.trim();
  assert.ok(status === '' || status.startsWith('Z'), `descendant ${pid} still runs: ${status}`);
});
