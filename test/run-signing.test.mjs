// Signatures bind exact manifest values. Verification never trusts a key embedded in a manifest.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chmodSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { machineKey, signManifest, signatureStatus, trustedKeys } from '../lib/worker/signing.mjs';
import { runManifest } from '../lib/worker/runs.mjs';
import { validateManifest } from '../lib/adapters/run-manifest.mjs';
import { loadConfig } from '../lib/project.mjs';
import { loadReports } from '../lib/verify-reports.mjs';
import { project, sha256 } from './worker-fixtures.mjs';
import { fileURLToPath } from 'node:url';

const make = () => runManifest({ inputs: { sha: 'a'.repeat(40), config: 'b'.repeat(64), lockfile: null },
  command: ['node', '--test'], startedAt: '2026-10-23T00:00:00Z', finishedAt: '2026-10-23T00:00:01Z', exitStatus: 0,
  artifact: { path: 'report.xml', kind: 'junit', digest: sha256('<testsuites><testsuite name="s"><testcase name="one"/></testsuite></testsuites>') }, backend: 'seatbelt', filters: [] });

test('signatures verify, survive JSON key order, and reject altered or unknown keys', (t) => {
  const fixture = project(t), key = machineKey(fixture.store), other = machineKey(join(fixture.work, 'other'));
  const signed = signManifest(make(), fixture.store);
  assert.equal(validateManifest(signed).ok, true);
  assert.deepEqual(signatureStatus(signed, [key.publicKey]), { state: 'valid', fingerprint: key.fingerprint });
  const reordered = Object.fromEntries(Object.entries(signed).reverse());
  assert.equal(signatureStatus(reordered, [key.publicKey]).state, 'valid');
  assert.equal(signatureStatus({ ...signed, exitStatus: 3 }, [key.publicKey]).state, 'invalid');
  assert.equal(signatureStatus(signed, [other.publicKey]).state, 'invalid');
  assert.deepEqual(signatureStatus(make(), []), { state: 'absent', fingerprint: null });
  assert.equal(signatureStatus({ ...signed, signature: null }, [key.publicKey]).state, 'invalid');
});

test('the persistent private key has mode 0600 and unsafe permissions are refused', (t) => {
  const fixture = project(t), first = machineKey(fixture.store), second = machineKey(fixture.store);
  assert.equal(first.publicKey, second.publicKey);
  assert.equal(statSync(first.file).mode & 0o777, 0o600);
  chmodSync(first.file, 0o644);
  assert.throws(() => machineKey(fixture.store), /0600/);
});

test('key CLI prints only the public key and fingerprint', (t) => {
  const fixture = project(t), cli = fileURLToPath(new URL('../bin/code-map.mjs', import.meta.url));
  const result = JSON.parse(execFileSync(process.execPath, [cli, 'key', '--store', fixture.store], { cwd: fixture.root, encoding: 'utf8' }));
  assert.match(result.publicKey, /BEGIN PUBLIC KEY/);
  assert.match(result.fingerprint, /^sha256:[a-f0-9]{64}$/);
  assert.equal(result.privateKey, undefined);
});

test('isolated manifests record operating system, release, architecture, Node and TypeScript', () => {
  const manifest = make();
  assert.equal(manifest.environment.node, process.versions.node);
  assert.equal(manifest.environment.architecture, process.arch);
  assert.ok(manifest.environment.os.length > 0);
  assert.ok(manifest.environment.osVersion.length > 0);
  assert.equal(manifest.environment.typescript, '6.0.3');
  assert.equal(validateManifest(manifest).ok, true);
});

test('verify excludes unknown and tampered signatures and accepts configured trusted keys', (t) => {
  const fixture = project(t), external = join(fixture.work, 'external'), key = machineKey(external), manifest = signManifest(make(), external);
  fixture.put('report.xml', '<testsuites><testsuite name="s"><testcase name="one"/></testsuite></testsuites>');
  fixture.put('manifest.json', JSON.stringify(manifest));
  const side = { inputs: { sha: manifest.source.sha, config: manifest.config, lockfile: null }, sha: manifest.source.sha, analysis: {} };
  const load = () => loadReports(fixture.root, [{ artifact: 'report.xml', manifest: 'manifest.json' }], { head: side, base: side }, undefined, fixture.store);
  assert.equal(load().executions[0].signature.state, 'invalid');
  assert.equal(load().reports.head.length, 0);
  fixture.put('.code-map.json', JSON.stringify({ trustedRunKeys: [key.publicKey] }));
  assert.deepEqual(trustedKeys(loadConfig(fixture.root).trustedRunKeys), [key.publicKey]);
  assert.equal(load().executions[0].signature.state, 'valid');
  assert.equal(load().reports.head.length, 1);
  fixture.put('manifest.json', JSON.stringify({ ...manifest, exitStatus: 2 }));
  assert.equal(load().reports.head.length, 0);
  assert.equal(load().executions[0].signature.fingerprint, key.fingerprint);
  fixture.put('.code-map.json', JSON.stringify({ trustedRunKeys: ['not a key'] }));
  assert.throws(() => loadConfig(fixture.root), /trustedRunKeys/);
});

test('verify keeps own evidence but rejects incompatible environment comparisons', (t) => {
  const fixture = project(t), base = make(), head = make();
  head.environment.osVersion = 'different release';
  fixture.put('report.xml', '<testsuites><testsuite name="s"><testcase name="one"/></testsuite></testsuites>');
  fixture.put('base.json', JSON.stringify(signManifest(base, fixture.store)));
  fixture.put('head.json', JSON.stringify(signManifest(head, fixture.store)));
  fixture.put('head.xml', readFileSync(join(fixture.root, 'report.xml')));
  const side = { inputs: { sha: base.source.sha, config: base.config, lockfile: null }, sha: base.source.sha, analysis: {} };
  const loaded = loadReports(fixture.root, [{ artifact: 'report.xml', manifest: 'base.json', side: 'base' },
    { artifact: 'head.xml', manifest: 'head.json' }], { base: side, head: side }, undefined, fixture.store);
  assert.deepEqual(loaded.executions[1].environmentComparisons, [{ artifact: 'report.xml', policy: 'exact-environment-v1', state: 'INCOMPARABLE', eligible: false, missingFields: [], differences: ['osVersion'] }]);
  assert.equal(loaded.executions[1].eligible, true);
  assert.equal(loaded.reports.head[0].comparisonEligible, true);
  assert.equal(loaded.executions[1].environmentComparisons[0].eligible, false);
});

test('key works outside a Git repository', (t) => {
  const fixture = project(t), cli = fileURLToPath(new URL('../bin/code-map.mjs', import.meta.url));
  const result = JSON.parse(execFileSync(process.execPath, [cli, 'key', '--store', fixture.store], { cwd: fixture.work, encoding: 'utf8' }));
  assert.match(result.publicKey, /BEGIN PUBLIC KEY/);
});

test('verification leaves a missing key store absent and labels unsigned reports', (t) => {
  const fixture = project(t), manifest = make();
  fixture.put('report.xml', '<testsuites><testsuite name="s"><testcase name="one"/></testsuite></testsuites>');
  fixture.put('manifest.json', JSON.stringify(manifest));
  const side = { inputs: { sha: manifest.source.sha, config: manifest.config, lockfile: null }, sha: manifest.source.sha, analysis: {} };
  const loaded = loadReports(fixture.root, [{ artifact: 'report.xml', manifest: 'manifest.json' }], { head: side, base: side }, undefined, fixture.store);
  assert.deepEqual(loaded.executions[0].signature, { state: 'absent', fingerprint: null });
  assert.equal(machineKey(fixture.store, { create: false }), null);
  assert.equal(loaded.reports.head.length, 1);
});

for (const field of ['architecture', 'typescript', 'osVersion']) {
  test(`comparison eligibility rejects different or absent ${field}`, (t) => {
    const fixture = project(t), base = make(), head = make();
    fixture.put('report.xml', '<testsuites><testsuite name="s"><testcase name="one"/></testsuite></testsuites>');
    fixture.put('head.xml', readFileSync(join(fixture.root, 'report.xml')));
    const side = { inputs: { sha: base.source.sha, config: base.config, lockfile: null }, sha: base.source.sha, analysis: {} };
    const load = () => loadReports(fixture.root, [{ artifact: 'report.xml', manifest: 'base.json', side: 'base' },
      { artifact: 'head.xml', manifest: 'head.json' }], { base: side, head: side }, undefined, fixture.store);
    head.environment[field] = 'different';
    fixture.put('base.json', JSON.stringify(signManifest(base, fixture.store)));
    fixture.put('head.json', JSON.stringify(signManifest(head, fixture.store)));
    assert.equal(load().executions[1].environmentComparisons[0].eligible, false);
    delete base.environment[field]; delete head.environment[field];
    fixture.put('base.json', JSON.stringify(signManifest(base, fixture.store)));
    fixture.put('head.json', JSON.stringify(signManifest(head, fixture.store)));
    const loaded = load();
    assert.equal(loaded.executions[1].environmentComparisons[0].state, 'UNKNOWN');
    assert.deepEqual(loaded.executions[1].environmentComparisons[0].missingFields, [field]);
    assert.equal(loaded.reports.head[0].comparisonEligible, false);
    assert.equal(loaded.executions[1].eligible, true);
  });
}
