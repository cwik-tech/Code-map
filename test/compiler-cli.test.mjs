// Compiler lifecycle acceptance through real manifests and the CLI. No project compiler executes here.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildManifest } from '../lib/manifest.mjs';
import { renderReport } from '../lib/verify-report.mjs';
import { defaults } from '../lib/project.mjs';
const cli = fileURLToPath(new URL('../bin/code-map.mjs', import.meta.url));
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'compiler-cli-')), work = mkdtempSync(join(tmpdir(), 'compiler-work-'));
  t.after(() => { rmSync(root, { recursive: true, force: true }); rmSync(work, { recursive: true, force: true }); });
  const put = (name, text) => { mkdirSync(dirname(join(root, name)), { recursive: true }); writeFileSync(join(root, name), text); };
  const git = (...args) => execFileSync('git', ['-C', root, '-c', 'user.name=test', '-c', 'user.email=test@local', ...args], { encoding: 'utf8' }).trim();
  const run = (...args) => spawnSync(process.execPath, [cli, ...args, '--store', join(work, 'store')], { cwd: root, encoding: 'utf8', timeout: 30000 });
  const bind = (name, text) => {
    const artifact = `reports/${name}.txt`, manifest = `${artifact}.manifest.json`;
    put(artifact, text);
    put(manifest, JSON.stringify(buildManifest(root, defaults, { artifact, kind: 'tsc', exitStatus: text ? '1' : '0', command: ['tsc', '--noEmit', '--pretty', 'false'] })));
    return { artifact, manifest };
  };
  put('.gitignore', 'reports/\n'); put('src/a.ts', 'export const a = 1;\n');
  git('init', '-q'); git('add', '.'); git('commit', '-qm', 'base');
  const base = git('rev-parse', 'HEAD');
  const before = bind('base', "src/a.ts(1,1): error TS2322: Type 'A' is not assignable to type 'B'.\nsrc/a.ts(2,1): error TS2304: Cannot find name 'gone'.\n");
  git('mv', 'src/a.ts', 'src/moved.ts'); git('commit', '-qm', 'move');
  const head = bind('head', "src/moved.ts(8,2): error TS2322: Type 'C' is not assignable to type 'D'.\nsrc/moved.ts(9,2): error TS2345: Argument is invalid.\n");
  return { root, work, put, run, base, before, head, bind };
}

test('inspect imports sidecar-bound compiler reports and shows counts and NEW diagnostics through a rename', (t) => {
  const f = fixture(t);
  const output = f.run('inspect', '--summary', '--ref', 'HEAD', '--base', f.base, '--compiler-report', f.head.artifact, '--base-compiler-report', f.before.artifact);
  assert.equal(output.status, 0, output.stderr);
  const result = JSON.parse(output.stdout).compiler;
  assert.deepEqual(result.counts, { new: 1, existing: 1, resolved: 1, unknown: 0 });
  assert.equal(result.newDiagnostics[0].diagnostic.code, 2345);
  assert.equal(result.executions.length, 2);
});

test('inspect refuses stale or absent manifests as evidence and requires summary with base', (t) => {
  const f = fixture(t);
  const manifest = JSON.parse(readFileSync(join(f.root, f.before.manifest), 'utf8'));
  f.put(f.before.manifest, JSON.stringify({ ...manifest, config: '0'.repeat(64) }));
  const output = f.run('inspect', '--summary', '--ref', 'HEAD', '--base', f.base, '--compiler-report', f.head.artifact, '--base-compiler-report', f.before.artifact);
  assert.equal(output.status, 0, output.stderr);
  const result = JSON.parse(output.stdout).compiler;
  assert.deepEqual(result.counts, { new: 0, existing: 0, resolved: 0, unknown: 2 });
  assert.equal(result.executions[1].eligible, false);
  const invalid = f.run('inspect', '--compiler-report', f.head.artifact);
  assert.equal(invalid.status, 1);
  assert.match(invalid.stderr, /--compiler-report needs --summary --base/);
});

test('verify exposes compiler lifecycle without changing static-baseline-v0 type results', (t) => {
  const f = fixture(t);
  const request = { requestType: 'code-map-verification-request', schemaVersion: 1, base: f.base, head: 'HEAD', intent: 'Move a file.',
    acceptanceCriteria: [], allowedPaths: ['src/**'], changeType: 'other', profileId: 'static-baseline-v0', ratingRulesVersion: 'ratings-v0',
    reportInputs: [f.head, f.before], execution: { enabled: false, authorization: null,
      budgets: { wallClockSeconds: 60, memoryMegabytes: 512, outputMegabytes: 8, concurrency: 1 } } };
  const path = join(f.work, 'request.json'); writeFileSync(path, JSON.stringify(request));
  const output = f.run('verify', '--request', path, '--out-dir', join(f.work, 'out'));
  assert.equal(output.status, 3, output.stderr);
  const summary = JSON.parse(output.stdout), results = JSON.parse(readFileSync(summary.files.results, 'utf8'));
  assert.deepEqual(results.compiler.counts, { new: 1, existing: 1, resolved: 1, unknown: 0 });
  assert.equal(results.compiler.entries.find((entry) => entry.baseline === 'NEW').diagnostic.code, 2345);
  assert.equal(results.obligations.find((item) => item.id === 'structure.types-compatible').result, 'FAIL');
  const markdown = readFileSync(summary.files.report, 'utf8');
  assert.match(markdown, /Compiler diagnostic lifecycle/);
  assert.match(markdown, /1 NEW, 1 EXISTING, 1 RESOLVED, 0 UNKNOWN/);
  assert.match(markdown, /TS2345/);
  const crowded = renderReport({ ...results, compiler: { ...results.compiler, counts: { new: 1000, existing: 0, resolved: 0, unknown: 0 },
    entries: Array.from({ length: 1000 }, () => results.compiler.entries.find((entry) => entry.baseline === 'NEW')) } });
  assert.ok(crowded.split('\n').length <= 200);
  assert.match(crowded, /more NEW diagnostics/);
  assert.ok(markdown.split('\n').length <= 200);
});


test('inspect with only a head report labels diagnostics UNKNOWN and rereads a deleted sidecar', (t) => {
  const f = fixture(t);
  const args = ['inspect', '--summary', '--ref', 'HEAD', '--base', f.base, '--compiler-report', f.head.artifact];
  const output = f.run(...args);
  assert.equal(output.status, 0, output.stderr);
  assert.deepEqual(JSON.parse(output.stdout).compiler.counts, { new: 0, existing: 0, resolved: 0, unknown: 2 });
  rmSync(join(f.root, f.head.manifest));
  const absent = f.run(...args);
  assert.equal(absent.status, 0, absent.stderr);
  assert.equal(JSON.parse(absent.stdout).compiler.executions[0].eligible, false);
  assert.equal(JSON.parse(absent.stdout).compiler.entries.length, 0);
});


test('inspection bounds diagnostic previews while retaining complete lifecycle counts', (t) => {
  const f = fixture(t);
  const head = f.bind('long-head', Array.from({ length: 30 }, (_, index) =>
    `src/moved.ts(1,1): error TS2304: Cannot find name 'name${index}'. ${'detail '.repeat(500)}`).join('\n'));
  const output = f.run('inspect', '--summary', '--ref', 'HEAD', '--base', f.base,
    '--compiler-report', head.artifact, '--base-compiler-report', f.before.artifact);
  assert.equal(output.status, 0, output.stderr);
  const result = JSON.parse(output.stdout).compiler;
  assert.equal(result.counts.new, 30);
  assert.equal(result.entries.length, 20);
  assert.equal(result.newDiagnostics.length, 20);
  assert.equal(result.truncated, true);
  assert.ok(Buffer.byteLength(JSON.stringify(result)) < 30000);
});

test('CLI help documents both compiler report flags and their sidecars', () => {
  const output = spawnSync(process.execPath, [cli, '--help'], { encoding: 'utf8', timeout: 10000 });
  assert.equal(output.status, 0, output.stderr);
  assert.match(output.stdout, /--compiler-report/);
  assert.match(output.stdout, /--base-compiler-report/);
  assert.match(output.stdout, /manifest\.json/);
});
