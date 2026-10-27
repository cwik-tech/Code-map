import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { analysisInputs } from '../lib/inputs.mjs';
import { loadConfig } from '../lib/project.mjs';
import { bindingStatus, validateManifest } from '../lib/adapters/run-manifest.mjs';
import { parseJUnit, supportedProducers as junitProducers } from '../lib/adapters/junit.mjs';
import { parseTestResults, supportedProducers as jsonProducers } from '../lib/adapters/test-results-json.mjs';

const hex = (char, length) => char.repeat(length);
const sha = hex('a', 40), worktree = hex('b', 64), config = hex('c', 64), lock = hex('d', 64), artifact = hex('e', 64);

function manifest(overrides = {}) {
  return {
    manifestType: 'code-map-run-manifest', schemaVersion: 1,
    source: { sha, worktreeDigest: worktree },
    command: ['npx', 'vitest', 'run', '--reporter=junit'], workingDirectory: '.',
    tools: [{ name: 'vitest', version: '3.2.4' }, { name: 'node', version: '24.21.0' }],
    config, lockfile: { path: 'package-lock.json', digest: lock },
    environment: { policy: 'restricted-worker-v1', node: '24.21.0', platform: 'darwin-arm64' },
    startedAt: '2026-10-22T18:00:00.000Z', finishedAt: '2026-10-22T18:00:05.250Z', exitStatus: 1,
    artifacts: [{ path: 'reports/junit.xml', digest: artifact, kind: 'junit' }],
    discovery: { scope: 'vitest run (all projects)', filters: [] },
    ...overrides,
  };
}

function inputs(overrides = {}) {
  return {
    manifestVersion: 1, repository: '/work/project', selector: { worktree: true, ref: null }, sha,
    worktree: { digest: hex('2', 64), entries: 3, contentDigest: worktree }, baseBranch: { name: 'main', sha: hex('f', 40) }, config,
    labels: { path: 'docs/code-map/test-labels.json', digest: null }, coverage: null,
    analyzer: { version: '1.0.0', source: hex('1', 64), typescript: '6.0.3', node: '24.21.0' },
    lockfile: { path: 'package-lock.json', digest: lock },
    ...overrides,
  };
}

test('a complete run manifest validates and is returned as an independent copy', () => {
  const value = manifest();
  const result = validateManifest(value);
  assert.equal(result.ok, true);
  assert.deepEqual(result.manifest, value);
  assert.notEqual(result.manifest, value);
  assert.equal(validateManifest(manifest({ lockfile: null, discovery: null, exitStatus: null, artifacts: [] })).ok, true);
  assert.equal(validateManifest(manifest({ source: { sha: hex('a', 64), worktreeDigest: null } })).ok, true, 'a SHA-256 repository has 64-character commit IDs');
  assert.equal(validateManifest(manifest({ source: { sha: hex('a', 52), worktreeDigest: null } })).ok, false);
});

test('manifest validation returns every error with its path, and unknown fields are errors', () => {
  const result = validateManifest(manifest({
    manifestType: 'other', schemaVersion: '1', source: { sha: 'abc', worktreeDigest: 7 }, command: [], tools: [{ name: '', version: '1' }],
    config: 'short', environment: { policy: 'p', node: 24, platform: null }, startedAt: 'yesterday', exitStatus: 1.5,
    artifacts: [{ path: 'r.xml', digest: artifact, kind: 'xml' }], discovery: { scope: 's', filters: [3] }, extra: true,
  }));
  assert.equal(result.ok, false);
  assert.deepEqual(result.errors.map((error) => error.path).sort(), [
    'artifacts[0].kind', 'command', 'config', 'discovery.filters[0]', 'environment.node', 'exitStatus', 'extra', 'manifestType',
    'schemaVersion', 'source.sha', 'source.worktreeDigest', 'startedAt', 'tools[0].name',
  ]);
  assert.ok(result.errors.every((error) => typeof error.message === 'string' && error.message.length > 0));
  assert.deepEqual(validateManifest(null).errors.map((error) => error.path), ['']);
  assert.deepEqual(validateManifest({}).errors.length, 14, 'each missing required field is reported');
});

test('working directories and artifact paths must stay inside the repository', () => {
  for (const path of ['/etc', '../outside', 'reports/../../x', 'C:\\temp', '\\\\server\\share', '', 'a\0b']) {
    const result = validateManifest(manifest({ workingDirectory: path, artifacts: [{ path, digest: artifact, kind: 'junit' }] }));
    assert.equal(result.ok, false, `${JSON.stringify(path)} must be rejected`);
    assert.deepEqual(result.errors.map((error) => error.path), ['workingDirectory', 'artifacts[0].path']);
  }
  const twice = validateManifest(manifest({ artifacts: [{ path: 'r.xml', digest: artifact, kind: 'junit' }, { path: 'r.xml', digest: artifact, kind: 'junit' }] }));
  assert.deepEqual(twice.errors.map((error) => error.path), ['artifacts[1].path']);
  assert.deepEqual(validateManifest(manifest({ finishedAt: '2026-10-22T17:59:59.000Z' })).errors.map((error) => error.path), ['finishedAt']);
});

test('a report is BOUND only when commit, worktree, config, lockfile and artifact digest all match', () => {
  assert.deepEqual(bindingStatus(manifest(), inputs(), { artifactDigest: artifact }), { state: 'BOUND', reasons: [] });
  const commit = manifest({ source: { sha, worktreeDigest: null } });
  assert.deepEqual(bindingStatus(commit, inputs({ selector: { worktree: false, ref: 'HEAD' }, worktree: null }), { artifactDigest: artifact }), { state: 'BOUND', reasons: [] });
  assert.equal(bindingStatus(manifest({ lockfile: null }), inputs({ lockfile: null }), { artifactDigest: artifact }).state, 'BOUND');
});

test('each mismatch makes the binding STALE and names its reason', () => {
  const cases = [
    ['sha', inputs({ sha: hex('9', 40) })],
    ['worktree', inputs({ worktree: { digest: worktree, entries: 1, contentDigest: hex('8', 64) } })],
    ['worktree', inputs({ worktree: null })],
    ['config', inputs({ config: hex('7', 64) })],
    ['lockfile', inputs({ lockfile: { path: 'package-lock.json', digest: hex('6', 64) } })],
    ['lockfile', inputs({ lockfile: null })],
  ];
  for (const [reason, current] of cases) {
    const result = bindingStatus(manifest(), current, { artifactDigest: artifact });
    assert.equal(result.state, 'STALE', reason);
    assert.deepEqual(result.reasons.map((item) => item.key), [reason]);
    assert.ok(result.reasons[0].message.length > 0);
  }
  const other = bindingStatus(manifest(), inputs(), { artifactDigest: hex('5', 64) });
  assert.deepEqual([other.state, other.reasons.map((item) => item.key)], ['STALE', ['artifact']]);
  const all = bindingStatus(manifest(), inputs({ sha: hex('9', 40), config: hex('7', 64) }), { artifactDigest: hex('5', 64) });
  assert.deepEqual(all.reasons.map((item) => item.key), ['sha', 'config', 'artifact']);
  assert.throws(() => bindingStatus(manifest(), inputs(), {}), TypeError);
});

test('a report without a valid manifest is UNBOUND and cannot satisfy readiness', () => {
  for (const missing of [null, undefined]) {
    const result = bindingStatus(missing, inputs(), { artifactDigest: artifact });
    assert.equal(result.state, 'UNBOUND');
    assert.deepEqual(result.reasons.map((item) => item.key), ['manifest']);
    assert.match(result.reasons[0].message, /readiness/);
  }
  const invalid = bindingStatus({ manifestType: 'code-map-run-manifest' }, inputs(), { artifactDigest: artifact });
  assert.equal(invalid.state, 'UNBOUND');
  assert.match(invalid.reasons[0].message, /invalid/);
});

test('a run manifest built from the analysis inputs binds to them, for a commit and for a changed working tree, edited snapshots included', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'code-map-binding-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const put = (path, text) => writeFileSync(join(root, path), text);
  put('package-lock.json', '{"lockfileVersion":3}\n'); put('index.ts', 'export const a = 1;\n'); put('index.test.ts.snap', 'v1\n');
  const git = (...args) => execFileSync('git', ['-C', root, '-c', 'user.name=test', '-c', 'user.email=test@example.com', ...args], { encoding: 'utf8' });
  git('init', '-q'); git('add', '.'); git('commit', '-qm', 'fixture');
  const config = loadConfig(root), digest = 'a'.repeat(64), worktree = () => analysisInputs(root, config, { worktree: true }, null);
  const manifestFor = (inputs) => manifest({ source: { sha: inputs.sha, worktreeDigest: inputs.worktree?.contentDigest ?? null }, config: inputs.config,
    lockfile: inputs.lockfile, artifacts: [{ path: 'reports/junit.xml', digest, kind: 'junit' }] });
  const keys = (run, inputs) => bindingStatus(manifestFor(run), inputs, { artifactDigest: digest }).reasons.map((reason) => reason.key);
  const commit = analysisInputs(root, config, { ref: 'HEAD' }, 'HEAD'), clean = worktree();
  assert.equal(commit.lockfile.path, 'package-lock.json');
  assert.equal(clean.worktree.contentDigest, null, 'a clean working tree binds like its commit');
  assert.deepEqual([keys(commit, commit), keys(commit, clean)], [[], []]);
  const edit = (text) => { put('index.test.ts.snap', text); return worktree(); };
  const v2 = edit('v2\n'), v3 = edit('v3\n');
  assert.deepEqual([keys(v3, v3), keys(commit, v3), keys(v2, v3)], [[], ['worktree'], ['worktree']], 'a snapshot edit that the analysis does not read');
  put('index.ts', 'export const a = 2;\n');
  const changed = worktree();
  assert.deepEqual([keys(changed, changed), keys(commit, changed)], [[], ['worktree']]);
});

test('an invalid run manifest names its first invalid fields, so the report can say what to fix', () => {
  const result = bindingStatus({ ...manifest(), schemaVersion: 2, command: [] }, { sha, worktree: null, config, lockfile: null }, { artifactDigest: artifact });
  assert.equal(result.state, 'UNBOUND');
  assert.match(result.reasons[0].message, /schemaVersion: Must be the integer 1\./);
  assert.match(result.reasons[0].message, /command: Must be a non-empty array of strings\./);
});
