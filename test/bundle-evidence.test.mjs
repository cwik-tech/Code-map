// Bound bundle evidence remains informational and uses validated report metadata.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { readSizes } from '../lib/sizes.mjs';
import { validateSizes } from '../lib/size-report.mjs';
import { bundleEvidence } from '../lib/bundle-evidence.mjs';

function build(t) {
  const root = mkdtempSync(join(tmpdir(), 'bundle-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'static/chunks/src'), { recursive: true });
  const put = (path, value) => writeFileSync(join(root, path), value);
  put('BUILD_ID', 'fixture');
  put('build-manifest.json', JSON.stringify({ pages: { '/': ['static/chunks/src/page.js', 'static/chunks/runtime.js'] } }));
  put('static/chunks/src/page.js', 'page'); put('static/chunks/runtime.js', 'runtime'); put('static/chunks/unused.js', 'unused');
  put('static/chunks/runtime.js.map', JSON.stringify({ version: 3, sources: ['webpack://_N_E/./src/hidden.ts', '/private/secret.ts'], mappings: '' }));
  return { root, put };
}

test('route chunks and their source maps explain orphan leads and list unused chunks', (t) => {
  const { root } = build(t), report = readSizes(root);
  assert.deepEqual(report.files.find((file) => file.path.endsWith('runtime.js')).sources, ['src/hidden.ts']);
  assert.equal(validateSizes(report).ok, true);
  const leads = ['src/page.tsx', 'src/hidden.ts', 'src/still.ts'].map((path) => ({ path, manifest: 'package.json' }));
  const evidence = bundleEvidence({ head: [report], base: [] }, { packages: { leads: { orphaned: leads } } });
  assert.deepEqual(evidence.unusedChunks.map((chunk) => chunk.path), ['static/chunks/unused.js']);
  assert.deepEqual(evidence.reachedOrphans.map((lead) => [lead.path, lead.via]), [
    ['src/page.tsx', 'chunk-name'], ['src/hidden.ts', 'source-map']]);
  assert.equal(evidence.state, 'HEAD_BOUND');
});

test('base-only and ambiguous reports cannot explain head orphans', () => {
  assert.equal(bundleEvidence({ head: [], base: [{}] }, {}).state, 'UNAVAILABLE');
  assert.equal(bundleEvidence({ head: [{}, {}], base: [] }, {}).state, 'AMBIGUOUS');
});

test('rejects untrusted source paths and malformed source maps', (t) => {
  const { root, put } = build(t), report = readSizes(root);
  const files = report.files.map((file) => file.path.endsWith('runtime.js') ? { ...file, sources: ['../outside.ts'] } : file);
  assert.equal(validateSizes({ ...report, files }).ok, false);
  put('static/chunks/runtime.js.map', '{');
  assert.throws(() => readSizes(root), /source map/i);
});

test('does not match partial filenames or source maps from unused chunks', (t) => {
  const { root, put } = build(t);
  put('static/chunks/unused.js.map', JSON.stringify({ version: 3, sources: ['src/still.ts'], mappings: '' }));
  const report = readSizes(root);
  const analysis = { packages: { leads: { orphaned: [{ path: 'src/still.ts' }, { path: 'src/pag.tsx' }] } } };
  assert.deepEqual(bundleEvidence({ head: [report], base: [] }, analysis).reachedOrphans, []);
});

test('verify exposes bound head bundle evidence and stored area totals without rating changes', async (t) => {
  const { execFileSync, spawnSync } = await import('node:child_process');
  const { readFileSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const { root, put } = build(t);
  const store = mkdtempSync(join(tmpdir(), 'bundle-store-'));
  t.after(() => rmSync(store, { recursive: true, force: true }));
  mkdirSync(join(root, 'src'));
  mkdirSync(join(root, 'reports'));
  put('.gitignore', 'static/\nreports/\nBUILD_ID\nbuild-manifest.json\n');
  put('package.json', '{"type":"module"}');
  put('src/hidden.ts', 'export function hidden() { if (true) return 1; }');
  put('src/main.ts', 'export const main = 1;');
  const git = (...args) => execFileSync('git', ['-C', root, '-c', 'user.name=test', '-c', 'user.email=test@local', ...args], { encoding: 'utf8' }).trim();
  git('init', '-q', '-b', 'main'); git('add', '.'); git('commit', '-qm', 'base');
  const base = git('rev-parse', 'HEAD');
  put('src/main.ts', 'export function main() { if (true) return 2; }');
  const cli = fileURLToPath(new URL('../bin/code-map.mjs', import.meta.url));
  const run = (...args) => spawnSync(process.execPath, [cli, ...args], { cwd: root, encoding: 'utf8', timeout: 30000 });
  const summary = run('inspect', '--worktree', '--summary', '--base', base, '--store', store);
  assert.equal(summary.status, 0, summary.stderr);
  assert.deepEqual(JSON.parse(summary.stdout).comparison.complexity.areas.files.map((r) => r.path), ['src/main.ts']);
  const request = { requestType: 'code-map-verification-request', schemaVersion: 1, base, head: 'worktree', intent: 'Inspect bundle.',
    acceptanceCriteria: [], allowedPaths: ['src/**'], changeType: 'other', profileId: 'static-baseline-v0', ratingRulesVersion: 'ratings-v0', reportInputs: [],
    execution: { enabled: false, authorization: null, budgets: { wallClockSeconds: 30, memoryMegabytes: 512, outputMegabytes: 8, concurrency: 1 } } };
  const verify = () => {
    writeFileSync(join(store, 'request.json'), JSON.stringify(request));
    const result = run('verify', '--request', join(store, 'request.json'), '--store', store, '--out-dir', join(store, 'out'));
    assert.equal(result.status, 3, result.stderr);
    return JSON.parse(readFileSync(JSON.parse(result.stdout).files.results, 'utf8'));
  };
  const without = verify();
  put('reports/sizes.json', JSON.stringify(readSizes(root)));
  const manifest = run('manifest', '--artifact', 'reports/sizes.json', '--kind', 'sizes', '--exit-status', '0', '--out', 'reports/manifest.json', '--', 'npm', 'run', 'build');
  assert.equal(manifest.status, 0, manifest.stderr);
  request.reportInputs = [{ artifact: 'reports/sizes.json', manifest: 'reports/manifest.json' }];
  const bound = verify();
  assert.equal(bound.bundle.state, 'HEAD_BOUND');
  assert.deepEqual(bound.bundle.reachedOrphans.map((lead) => lead.path), ['src/hidden.ts']);
  assert.equal(bound.complexity.areas.files.find((row) => row.path === 'src/main.ts').head.sum, 1);
  assert.deepEqual(bound.completeness.map((row) => row.stack), ['TypeScript', 'JavaScript', 'JSX and TSX', 'JSON', 'CSS', 'Python', 'other']);
  assert.deepEqual(bound.ratings, without.ratings);
  assert.deepEqual(bound.obligations, without.obligations);
});
