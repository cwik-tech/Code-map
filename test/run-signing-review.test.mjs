// Review regressions use real store files and malformed manifest inputs.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, writeFileSync, symlinkSync, unlinkSync, existsSync } from 'node:fs';
import { execFile, spawnSync } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
import { validateManifest } from '../lib/adapters/run-manifest.mjs';
import { cacheMutation, cachedMutation } from '../lib/mutation/cache.mjs';
import { loadReports } from '../lib/verify-reports.mjs';
import { repositoryDigest } from '../lib/worker/authorize.mjs';
import { newRunId, runManifest, stageRun } from '../lib/worker/runs.mjs';
import { machineKey, signManifest } from '../lib/worker/signing.mjs';
import { evaluate } from './profile-fixtures.mjs';
import { project, sha256 } from './worker-fixtures.mjs';
import { fileURLToPath } from 'node:url';

const inputs = () => ({ sha: 'a'.repeat(40), config: 'b'.repeat(64), lockfile: null });
const make = (artifact) => runManifest({ inputs: inputs(), command: ['node', '--test'], startedAt: '2026-10-23T00:00:00Z',
  finishedAt: '2026-10-23T00:00:01Z', exitStatus: 0, artifact, backend: 'seatbelt', filters: [] });

test('manifest validation rejects malformed signature metadata', () => {
  const manifest = make({ path: 'report.xml', digest: 'c'.repeat(64), kind: 'junit' });
  assert.equal(validateManifest({ ...manifest, signature: 42 }).ok, false);
  assert.equal(validateManifest({ ...manifest, signature: { algorithm: 'RSA', fingerprint: 'x', value: 'x' } }).ok, false);
});

test('the mutation cache refuses a manifest with a damaged signature', (t) => {
  const f = project(t), key = 'c'.repeat(64), bytes = JSON.stringify({ files: {}, cacheKey: key, seed: 1, candidates: 0 });
  const id = newRunId(new Date('2026-10-23T00:00:00Z')), stage = stageRun(f.store, id);
  const artifact = { path: 'mutation.json', file: 'report.json', digest: sha256(bytes), kind: 'stryker-json' };
  const manifest = signManifest(make(artifact), f.store);
  stage.put('report.json', bytes);
  stage.put('manifest.json', JSON.stringify(manifest));
  stage.put('run.json', JSON.stringify({ recordType: 'code-map-run-record', schemaVersion: 1, runId: id,
    repository: { digest: repositoryDigest(f.root) }, policy: 'isolated', backend: { name: 'seatbelt' },
    workspace: { tree: join(f.work, 'tree') }, artifact }));
  stage.close(); const folder = stage.publish();
  cacheMutation(f.store, key, id);
  assert.equal(cachedMutation(f.store, key, f.root, inputs()).cached, true);
  const file = join(folder, 'manifest.json'), changed = JSON.parse(readFileSync(file, 'utf8'));
  changed.signature.value = 'A'.repeat(86) + '==';
  writeFileSync(file, JSON.stringify(changed));
  assert.throws(() => cachedMutation(f.store, key, f.root, inputs()), /signature|damaged/);
});

test('missing historical environment fields remain unknown during comparison', (t) => {
  const f = project(t), bytes = '<testsuites><testsuite name="s"><testcase name="one"><failure/></testcase></testsuite></testsuites>';
  const manifest = make({ path: 'base.xml', digest: sha256(bytes), kind: 'junit' });
  manifest.exitStatus = 1;
  manifest.environment = { policy: 'isolated', node: process.versions.node, platform: process.platform, backend: 'seatbelt' };
  f.put('base.xml', bytes); f.put('head.xml', bytes);
  f.put('base.json', JSON.stringify(signManifest(manifest, f.store)));
  f.put('head.json', JSON.stringify(signManifest(manifest, f.store)));
  const side = { inputs: inputs(), sha: inputs().sha, analysis: {} };
  const loaded = loadReports(f.root, [{ artifact: 'base.xml', manifest: 'base.json', side: 'base' },
    { artifact: 'head.xml', manifest: 'head.json' }], { base: side, head: side }, undefined, f.store);
  assert.equal(loaded.executions[1].environmentComparisons[0].state, 'UNKNOWN');
  const result = evaluate({ reports: loaded.reports });
  assert.equal(result.byId['behavior.earlier-failures'].result, 'UNKNOWN');
  assert.equal(result.byId['behavior.no-new-failures'].result, 'FAIL');
  assert.deepEqual(loaded.executions[1].environmentComparisons[0].missingFields, ['os', 'osVersion', 'architecture', 'typescript']);
});


test('concurrent first key commands select the same public key', async (t) => {
  const f = project(t), cli = fileURLToPath(new URL('../bin/code-map.mjs', import.meta.url));
  const command = () => promisify(execFile)(process.execPath, [cli, 'key', '--store', f.store], { cwd: f.work, timeout: 10000 });
  const [first, second] = await Promise.all([command(), command()]);
  assert.equal(JSON.parse(first.stdout).publicKey, JSON.parse(second.stdout).publicKey);
  assert.equal(JSON.parse(first.stdout).fingerprint, JSON.parse(second.stdout).fingerprint);
});

test('a signing key symlink is refused', (t) => {
  const f = project(t), key = machineKey(f.store), other = machineKey(join(f.work, 'other-store'));
  unlinkSync(key.file); symlinkSync(other.file, key.file);
  assert.throws(() => machineKey(f.store), /ELOOP|symbolic|symlink/);
});

test('key refuses a store inside the repository', (t) => {
  const f = project(t), cli = fileURLToPath(new URL('../bin/code-map.mjs', import.meta.url));
  const result = spawnSync(process.execPath, [cli, 'key', '--store', f.root], { cwd: f.root, encoding: 'utf8', timeout: 10000 });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /outside the repository/);
  assert.equal(existsSync(join(f.root, 'keys')), false);
});
