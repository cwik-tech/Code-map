// Real sandbox checks of the signed run and sampled resource records.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { budgetsFrom, checkBudgets, defaultBudgets, budgetProblem } from '../lib/worker/budgets.mjs';
import { machineKey, signatureStatus } from '../lib/worker/signing.mjs';
import { project, run, sandboxed } from './worker-fixtures.mjs';

test('an optional disk budget must be positive and cannot exceed or bypass authorization', () => {
  assert.deepEqual(budgetsFrom({ 'disk-megabytes': '12' }), { diskMegabytes: 12 });
  assert.throws(() => budgetsFrom({ 'disk-megabytes': '0' }), /whole number/);
  assert.equal(budgetProblem({ ...defaultBudgets, diskMegabytes: 12 }), null);
  assert.throws(() => checkBudgets({ ...defaultBudgets }, { ...defaultBudgets, diskMegabytes: 12 }), /diskMegabytes/);
  assert.throws(() => checkBudgets({ ...defaultBudgets, diskMegabytes: 13 }, { ...defaultBudgets, diskMegabytes: 12 }), /diskMegabytes/);
});

test('the sampled disk budget stops a growing workspace and keeps no artifact', sandboxed, async (t) => {
  const fixture = project(t), script = 'require("fs").writeFileSync("large", Buffer.alloc(4 * 1024 * 1024, 1)); setInterval(() => {}, 1000)';
  const result = await run(fixture, [process.execPath, '-e', script], { budgets: { diskMegabytes: 1, wallClockSeconds: 15 } });
  assert.equal(result.record.stoppedBy, 'diskMegabytes');
  assert.ok(result.record.disk.peakMegabytes > 1);
  assert.equal(result.record.disk.limit, 'sampled');
  assert.equal(result.record.artifact, null);
  assert.equal(result.exitCode, 1);
});

test('a signed run records observed process IDs and surviving process IDs', sandboxed, async (t) => {
  const fixture = project(t), script = 'console.log(process.pid); require("child_process").spawn(process.execPath, ["-e", "console.log(process.pid); setInterval(() => {}, 1000)"], { detached: true, stdio: "inherit" }); setInterval(() => {}, 1000)';
  const stopped = await run(fixture, [process.execPath, '-e', script], { budgets: { wallClockSeconds: 1 } });
  const pids = readFileSync(stopped.paths.stdout, 'utf8').trim().split('\n').map(Number);
  assert.equal(pids.length, 2);
  assert.ok(stopped.record.processes.started.includes(pids[0]));
  assert.ok(stopped.record.processes.started.includes(pids[1]));
  assert.deepEqual(stopped.record.processes.remaining, []);
  const xml = '<testsuites><testsuite name="s"><testcase name="one"/></testsuite></testsuites>';
  const result = await run(fixture, [process.execPath, '-e', `require("fs").writeFileSync("report.xml", ${JSON.stringify(xml)})`], { kind: 'junit', artifact: 'report.xml' });
  const manifest = JSON.parse(readFileSync(result.paths.manifest, 'utf8'));
  assert.equal(signatureStatus(manifest, [machineKey(fixture.store).publicKey]).state, 'valid');
});
