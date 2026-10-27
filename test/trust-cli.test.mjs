// CLI and real-worker acceptance tests for trust policies and unchanged v0 decisions.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildManifest } from '../lib/manifest.mjs';
import { loadConfig } from '../lib/project.mjs';
import { newAuthorization, saveAuthorization } from '../lib/worker/authorize.mjs';
import { project, budgets, run, sandboxed } from './worker-fixtures.mjs';
import { loadReports } from '../lib/verify-reports.mjs';
const root = fileURLToPath(new URL('..', import.meta.url)), cli = join(root, 'bin/code-map.mjs');

test('authorize CLI validates and stores tool minimums', (t) => {
  const f = project(t), trust = { npm: 'isolated', tsc: 'self-attested' };
  const output = execFileSync(process.execPath, [cli, 'authorize', '--store', f.store, '--trust', JSON.stringify(trust), '--command', 'npm', 'test'],
    { cwd: f.root, encoding: 'utf8', timeout: 10000 });
  const result = JSON.parse(output);
  assert.deepEqual(result.trust, trust);
  assert.deepEqual(JSON.parse(readFileSync(result.file)).trust, trust);
  const invalid = spawnSync(process.execPath, [cli, 'authorize', '--store', f.store, '--trust', '{"npm":"unknown"}', '--command', 'npm', 'test'],
    { cwd: f.root, encoding: 'utf8', timeout: 10000 });
  assert.equal(invalid.status, 1);
  assert.match(invalid.stderr, /trust/);
});

test('a real worker retains authorization minimums and verify refuses evidence below them', sandboxed, async (t) => {
  const f = project(t), command = [process.execPath, '--test', '--test-reporter=junit', '--test-reporter-destination=report.xml'];
  const trust = { [process.execPath]: 'trusted-signed' };
  const record = newAuthorization({ repository: f.root, command, budgets, trust });
  saveAuthorization(f.store, record);
  const result = await run(f, command, { authorization: record.id, kind: 'junit', artifact: 'report.xml' });
  assert.equal(result.exitCode, 0);
  assert.deepEqual(result.record.trust, trust);
  const manifest = JSON.parse(readFileSync(result.paths.manifest)), side = {
    inputs: { sha: manifest.source.sha, config: manifest.config, lockfile: manifest.lockfile }, sha: manifest.source.sha, analysis: {} };
  const loaded = loadReports(f.root, [{ run: result.record.runId }], { head: side, base: side }, undefined, f.store);
  assert.equal(loaded.executions[0].tier, 'isolated-signed');
  assert.equal(loaded.executions[0].eligible, false);
  assert.equal(loaded.executions[0].reasons[0].key, 'trust');
});

test('v0 decisions with a bound imported report and no trust field match c60f5aa', (t) => {
  const f = project(t);
  f.put('src/sum.mjs', 'export function sum(a, b) { return (a + b); }\n');
  f.git('add', '.'); f.git('commit', '-qm', 'head');
  f.put('reports/report.xml', '<testsuites><testsuite name="sum"><testcase name="adds two numbers" file="test/sum.test.mjs"/></testsuite></testsuites>');
  const manifest = buildManifest(f.root, loadConfig(f.root), { artifact: 'reports/report.xml', kind: 'junit', exitStatus: '0', command: ['vitest', 'run'], filters: [] });
  f.put('reports/manifest.json', JSON.stringify(manifest));
  const request = join(f.work, 'request.json');
  writeFileSync(request, JSON.stringify({ requestType: 'code-map-verification-request', schemaVersion: 1, base: 'base', head: 'HEAD', intent: 'Simplify addition.',
    acceptanceCriteria: [], allowedPaths: ['src/**'], changeType: 'other', profileId: 'static-baseline-v0', ratingRulesVersion: 'ratings-v0',
    reportInputs: [{ artifact: 'reports/report.xml', manifest: 'reports/manifest.json' }], execution: { enabled: false, authorization: null, budgets } }));
  // Captured from c60f5aa; contributors do not need the repository's historical Git objects.
  const before = JSON.parse(readFileSync(new URL('./fixtures/v0-baselines/trust-c60f5aa.json', import.meta.url), 'utf8'));
  const verify = (binary, store) => {
    const output = spawnSync(process.execPath, [binary, 'verify', '--request', request, '--store', store], { cwd: f.root, encoding: 'utf8', timeout: 30000 });
    assert.ok([0, 1, 2, 3].includes(output.status), output.stderr);
    const files = JSON.parse(output.stdout).files;
    return { status: output.status, results: JSON.parse(readFileSync(files.results)), report: readFileSync(files.report, 'utf8') };
  };
  const after = verify(cli, f.store);
  assert.equal(after.status, before.status);
  assert.equal(after.results.executions[0].eligible, true);
  assert.equal(after.results.executions[0].tier, 'self-attested');
  assert.match(after.report, /Tier: self-attested/);
  const normalize = (value, result) => JSON.parse(JSON.stringify(value).replaceAll(result.base.analysisId, 'BASE').replaceAll(result.head.analysisId, 'HEAD'));
  assert.deepEqual(normalize(after.results.ratings, after.results), before.ratings);
  assert.deepEqual(after.results.readiness, before.readiness);
  assert.deepEqual(normalize(after.results.obligations, after.results), before.obligations);
});
