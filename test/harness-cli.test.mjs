// Acceptance: the public harness command produces a stored run that verify shows as information.
import { machineKey, signatureStatus } from '../lib/worker/signing.mjs';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { harnessCommand } from '../lib/harness/run.mjs';
import { authorize, project, sandboxed } from './worker-fixtures.mjs';
const cli = fileURLToPath(new URL('../bin/code-map.mjs', import.meta.url));

test('CLI harness and verify retain isolated observations without changing readiness', sandboxed, (t) => {
  const f = project(t);
  f.put('subject.mjs', 'export const subject = (x) => x; export const invariant = (x, y) => x === y;');
  f.put('harness.json', JSON.stringify({ harnessVersion: 1, mode: 'property', subject: { file: 'subject.mjs', export: 'subject' },
    invariant: { file: 'subject.mjs', export: 'invariant' }, seed: 1, count: 2, callTimeoutMs: 2000, generator: { type: 'boolean' } }));
  f.git('add', '.'); f.git('commit', '-qm', 'subject');
  const authorization = authorize(f, harnessCommand);
  const command = spawnSync(process.execPath, [cli, 'harness', '--authorization', authorization, '--spec', 'harness.json', '--store', f.store], { cwd: f.root, encoding: 'utf8', timeout: 30000 });
  assert.equal(command.status, 0, command.stderr);
  const summary = JSON.parse(command.stdout);
  assert.equal(summary.policy, 'isolated');
  assert.equal(signatureStatus(JSON.parse(readFileSync(summary.files.manifest, 'utf8')), [machineKey(f.store).publicKey]).state, 'valid');
  const report = JSON.parse(readFileSync(summary.files.artifact, 'utf8'));
  assert.equal(report.calls.length, 2);
  assert.equal(report.failures.length, 0);
  const path = join(f.work, 'request.json');
  const request = { requestType: 'code-map-verification-request', schemaVersion: 1, base: 'HEAD', head: 'HEAD', intent: 'Check the subject', acceptanceCriteria: [],
    allowedPaths: null, changeType: 'other', profileId: 'static-baseline-v0', ratingRulesVersion: 'ratings-v0', reportInputs: [{ run: summary.runId }],
    execution: { enabled: false, authorization: null, budgets: { wallClockSeconds: 60, memoryMegabytes: 512, outputMegabytes: 8, concurrency: 1 } } };
  writeFileSync(path, JSON.stringify(request));
  const verify = spawnSync(process.execPath, [cli, 'verify', '--request', path, '--store', f.store], { cwd: f.root, encoding: 'utf8', timeout: 30000 });
  assert.equal(verify.status, 3, verify.stderr);
  const verified = JSON.parse(verify.stdout), results = JSON.parse(readFileSync(verified.files.results, 'utf8'));
  assert.equal(results.executions[0].harness.mode, 'property');
  assert.equal(results.executions[0].binding, 'BOUND');
  assert.equal(results.executions[0].eligible, false);
  const markdown = readFileSync(verified.files.report, 'utf8');
  assert.match(markdown, /Information only/);
  assert.match(markdown, /Signature: valid/);
  assert.ok(markdown.includes(machineKey(f.store).fingerprint));
  assert.match(markdown, /property: 2 calls, 0 failures/);
  assert.doesNotMatch(markdown, /binding state BOUND/);
});
