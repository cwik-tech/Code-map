// Evidence tiers and tool minimums use provenance, never manifest policy claims.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { join } from 'node:path';
import { evidenceTier, trustPolicy, trustDecision } from '../lib/trust.mjs';
import { loadConfig } from '../lib/project.mjs';
import { loadReports } from '../lib/verify-reports.mjs';
import { machineKey, signManifest } from '../lib/worker/signing.mjs';
import { runManifest, stageRun, runFiles } from '../lib/worker/runs.mjs';
import { newAuthorization, saveAuthorization, loadAuthorization, repositoryDigest } from '../lib/worker/authorize.mjs';
import { project, sha256, budgets } from './worker-fixtures.mjs';

const xml = '<testsuites><testsuite name="s"><testcase name="one"/></testsuite></testsuites>';
function fixture(t) {
  const f = project(t), manifest = runManifest({ inputs: { sha: 'a'.repeat(40), config: 'b'.repeat(64), lockfile: null },
    command: ['vitest', 'run'], startedAt: '2026-10-23T00:00:00Z', finishedAt: '2026-10-23T00:00:01Z', exitStatus: 0,
    artifact: { path: 'report.xml', kind: 'junit', digest: sha256(xml) }, backend: 'seatbelt', filters: [] });
  const side = { inputs: { sha: manifest.source.sha, config: manifest.config, lockfile: null }, sha: manifest.source.sha, analysis: {} };
  f.put('report.xml', xml);
  return { ...f, manifest, load: (inputs = [{ artifact: 'report.xml', manifest: 'manifest.json' }]) =>
    loadReports(f.root, inputs, { head: side, base: side }, undefined, f.store) };
}
function stored(f, manifest, trust) {
  const id = 'R-20261023T000000Z-0123abcd', stage = stageRun(f.store, id);
  stage.put('report.xml', xml);
  stage.put(runFiles.manifest, JSON.stringify(manifest));
  stage.put(runFiles.record, JSON.stringify({ recordType: 'code-map-run-record', schemaVersion: 1, runId: id,
    repository: { digest: repositoryDigest(f.root) }, policy: 'isolated', backend: { name: 'seatbelt' },
    workspace: { tree: f.root }, artifact: { path: 'report.xml', file: 'report.xml', kind: 'junit', digest: sha256(xml) }, ...(trust ? { trust } : {}) }));
  stage.close(); stage.publish();
  return [{ run: id }];
}

test('static analysis has the static tier and every minimum uses the ordered tiers', () => {
  assert.equal(evidenceTier({}), 'static');
  assert.equal(trustDecision('isolated', ['npm', 'test'], { npm: 'isolated' }).allowed, true);
  assert.equal(trustDecision('self-attested', ['npm', 'test'], { npm: 'isolated' }).allowed, false);
  assert.equal(trustDecision('self-attested', ['tsc'], { tsc: 'self-attested', npm: 'isolated' }).allowed, true);
});
test('unsigned imported reports stay self-attested despite isolated policy claims and retain default eligibility', (t) => {
  const f = fixture(t); f.put('manifest.json', JSON.stringify(f.manifest));
  assert.equal(f.load().executions[0].tier, 'self-attested');
  assert.equal(f.load().reports.head.length, 1);
  f.put('.code-map.json', JSON.stringify({ trust: {} }));
  assert.equal(f.load().reports.head.length, 1);
});
test('tool minimum refuses a bound report with an explicit reason', (t) => {
  const f = fixture(t); f.put('manifest.json', JSON.stringify(f.manifest));
  f.put('.code-map.json', JSON.stringify({ trust: { vitest: 'isolated' } }));
  const loaded = f.load();
  assert.equal(loaded.reports.head.length, 0);
  assert.equal(loaded.executions[0].binding, 'BOUND');
  assert.equal(loaded.executions[0].eligible, false);
  assert.match(loaded.executions[0].reasons[0].message, /vitest.*self-attested.*isolated/);
});
test('unsigned private worker records have the isolated tier', (t) => {
  const f = fixture(t);
  assert.equal(f.load(stored(f, f.manifest)).executions[0].tier, 'isolated');
});
test('local signatures give isolated-signed only to private worker runs', (t) => {
  const f = fixture(t), signed = signManifest(f.manifest, f.store);
  f.put('manifest.json', JSON.stringify(signed));
  assert.equal(f.load().executions[0].tier, 'self-attested');
  assert.equal(f.load(stored(f, signed)).executions[0].tier, 'isolated-signed');
});
test('a configured valid signature gives trusted-signed and satisfies the highest minimum', (t) => {
  const f = fixture(t), remote = join(f.work, 'remote'), key = machineKey(remote);
  f.put('manifest.json', JSON.stringify(signManifest(f.manifest, remote)));
  f.put('.code-map.json', JSON.stringify({ trustedRunKeys: [key.publicKey], trust: { vitest: 'trusted-signed' } }));
  assert.equal(f.load().executions[0].tier, 'trusted-signed');
  assert.equal(f.load().reports.head.length, 1);
});
test('authorization tool policies survive storage and cannot lower repository minimums', (t) => {
  const f = fixture(t), trust = { vitest: 'trusted-signed' };
  const record = newAuthorization({ repository: f.root, command: ['vitest', 'run'], budgets, trust });
  saveAuthorization(f.store, record);
  assert.deepEqual(loadAuthorization(f.store, record.id).trust, trust);
  const loaded = f.load(stored(f, f.manifest, trust));
  assert.equal(loaded.reports.head.length, 0);
  assert.equal(trustDecision('isolated', ['vitest'], { vitest: 'trusted-signed' }, { vitest: 'self-attested' }).allowed, false);
});
test('invalid policy values and tool names fail closed', () => {
  assert.throws(() => trustPolicy(null), /trust/);
  assert.throws(() => trustPolicy({ vitest: 'sandbox' }), /trust/);
  assert.throws(() => trustPolicy({ 'npm test': 'isolated' }), /trust/);
  assert.throws(() => trustPolicy([]), /trust/);
  assert.throws(() => trustPolicy({ '': 'static' }), /trust/);
  assert.throws(() => trustPolicy({ '-tool': 'static' }), /trust/);
  assert.throws(() => trustPolicy({ ['tool' + String.fromCharCode(0)]: 'static' }), /trust/);
  assert.throws(() => trustPolicy({ ['x'.repeat(4097)]: 'static' }), /trust/);
  assert.throws(() => trustPolicy(Object.fromEntries(Array.from({ length: 65 }, (_, i) => [`tool${i}`, 'static']))), /trust/);
  const maximum = Object.fromEntries(Array.from({ length: 64 }, (_, i) => [`tool${i}`, 'static']));
  assert.deepEqual(trustPolicy(maximum), maximum);
});

test('invalid configuration and private-record policies cannot bypass minimums', (t) => {
  const f = fixture(t);
  f.put('.code-map.json', JSON.stringify({ trust: { vitest: 'unknown' } }));
  assert.throws(() => loadConfig(f.root), /trust/);
  f.put('.code-map.json', '{}');
  const loaded = f.load(stored(f, f.manifest, { vitest: 'unknown' }));
  assert.equal(loaded.reports.head.length, 0);
  assert.match(loaded.executions[0].reasons[0].message, /trust/);
});
test('unknown and tampered signatures never reach trusted-signed eligibility', (t) => {
  const f = fixture(t), remote = join(f.work, 'remote'), key = machineKey(remote), signed = signManifest(f.manifest, remote);
  f.put('manifest.json', JSON.stringify(signed));
  assert.equal(f.load().executions[0].eligible, false);
  assert.notEqual(f.load().executions[0].tier, 'trusted-signed');
  f.put('.code-map.json', JSON.stringify({ trustedRunKeys: [key.publicKey] }));
  f.put('manifest.json', JSON.stringify({ ...signed, exitStatus: 1 }));
  assert.equal(f.load().executions[0].eligible, false);
  assert.notEqual(f.load().executions[0].tier, 'trusted-signed');
});
test('stale evidence stays ineligible even with the highest signature tier', (t) => {
  const f = fixture(t), key = machineKey(f.store);
  f.put('.code-map.json', JSON.stringify({ trustedRunKeys: [key.publicKey] }));
  f.put('manifest.json', JSON.stringify(signManifest({ ...f.manifest, config: 'c'.repeat(64) }, f.store)));
  assert.equal(f.load().executions[0].tier, 'trusted-signed');
  assert.equal(f.load().executions[0].eligible, false);
});
