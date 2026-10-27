import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { runVerify } from '../lib/verify.mjs';
import { loadConfig } from '../lib/project.mjs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const cli = fileURLToPath(new URL('../bin/code-map.mjs', import.meta.url));
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'typed-cli-')), store = mkdtempSync(join(tmpdir(), 'typed-store-'));
  t.after(() => { rmSync(root, { recursive: true, force: true }); rmSync(store, { recursive: true, force: true }); });
  const git = (...args) => execFileSync('git', ['-C', root, '-c', 'user.name=test', '-c', 'user.email=test@local', ...args], { encoding: 'utf8' }).trim();
  const write = (path, text) => writeFileSync(join(root, path), text);
  mkdirSync(join(root, 'src'));
  git('init', '-q');
  write('package.json', '{"main":"src/api.ts","version":"0.1.0"}');
  write('tsconfig.json', '{"compilerOptions":{"strict":true},"include":["src/api.ts","src/use.ts"]}');
  write('src/api.ts', 'export function value(x: string) { return x; }\nexport const old = 1;');
  write('src/use.ts', "import { value, old } from './api'; value('x'); old;");
  git('add', '.'); git('commit', '-qm', 'base');
  const base = git('rev-parse', 'HEAD');
  write('src/api.ts', 'export function value(x: number) { return x; }');
  write('src/excluded.ts', 'export const excluded = 1;');
  git('add', '.'); git('commit', '-qm', 'head');
  const run = (...args) => spawnSync(process.execPath, [cli, ...args], { cwd: root, encoding: 'utf8', timeout: 30000 });
  const json = (...args) => { const result = run(...args); assert.equal(result.status, 0, result.stderr); return JSON.parse(result.stdout); };
  return { root, store, write, base, run, json };
}

test('inspect --types exposes compiler facts and keeps separate stored identities', (t) => {
  const f = fixture(t);
  const plain = f.json('inspect', '--worktree', '--history', '2');
  assert.equal(plain.typed, undefined);
  const typed = f.json('inspect', '--worktree', '--history', '2', '--types');
  assert.equal(typed.typed.state, 'COMPLETE');
  assert.equal(typed.typed.calls[0].compatibility, 'INCOMPATIBLE');
  const a = f.json('inspect', '--summary', '--worktree', '--store', f.store);
  const b = f.json('inspect', '--summary', '--worktree', '--types', '--store', f.store);
  assert.notEqual(a.analysis.id, b.analysis.id);
  const stored = f.json('inspect', '--analysis', b.analysis.id, '--full', '--store', f.store);
  assert.equal(stored.analysis.freshness.state, 'current');
});

test('verify retains v0 obligations and reports unchecked files, incompatible calls and stale references as information', (t) => {
  const f = fixture(t);
  const request = { requestType: 'code-map-verification-request', schemaVersion: 1, base: f.base, head: 'HEAD', intent: 'change API',
    acceptanceCriteria: [], allowedPaths: ['**'], changeType: 'other', profileId: 'static-baseline-v0', ratingRulesVersion: 'ratings-v0',
    reportInputs: [], execution: { enabled: false, authorization: null, budgets: { wallClockSeconds: 10, memoryMegabytes: 256, outputMegabytes: 1, concurrency: 1 } } };
  f.write('request.json', JSON.stringify(request));
  const run = () => {
    const output = f.run('verify', '--request', join(f.root, 'request.json'), '--store', f.store);
    assert.notEqual(output.status, 4, output.stderr);
    const summary = JSON.parse(output.stdout);
    return JSON.parse(readFileSync(summary.files.results, 'utf8'));
  };
  const plain = run();
  const typed = runVerify(f.root, { ...loadConfig(f.root), typeCheck: true }, { request: join(f.root, 'request.json'), store: f.store }).results;
  const outcomes = (result) => result.obligations.map(({ id, result, eligible }) => ({ id, result, eligible }));
  assert.deepEqual(outcomes(typed), outcomes(plain));
  assert.equal(typed.types.compilerCoverage.state, 'UNKNOWN');
  assert.deepEqual(typed.types.compilerCoverage.unchecked, ['src/excluded.ts']);
  assert.equal(typed.types.calls[0].compatibility, 'INCOMPATIBLE');
  assert.ok(typed.types.staleReferences.some((reference) => reference.name === 'old' && reference.evidence === 'language-service'));
});

test('a clean bound diagnostic report does not hide a compiler discovery gap', async (t) => {
  const { buildManifest } = await import('../lib/manifest.mjs');
  const f = fixture(t), config = { ...loadConfig(f.root), typeCheck: true };
  f.write('tsc.txt', '');
  const manifest = buildManifest(f.root, config, { artifact: 'tsc.txt', kind: 'tsc', exitStatus: '0', command: ['tsc', '--noEmit', '--pretty', 'false'] });
  f.write('tsc.manifest.json', JSON.stringify({ ...manifest, source: { ...manifest.source, worktreeDigest: null } }));
  const request = { requestType: 'code-map-verification-request', schemaVersion: 1, base: f.base, head: 'HEAD', intent: 'check discovery',
    acceptanceCriteria: [], allowedPaths: ['**'], changeType: 'other', profileId: 'static-baseline-v0', ratingRulesVersion: 'ratings-v0',
    reportInputs: [{ artifact: 'tsc.txt', manifest: 'tsc.manifest.json' }],
    execution: { enabled: false, authorization: null, budgets: { wallClockSeconds: 10, memoryMegabytes: 256, outputMegabytes: 1, concurrency: 1 } } };
  f.write('request.json', JSON.stringify(request));
  const { results } = runVerify(f.root, config, { request: join(f.root, 'request.json'), store: f.store });
  assert.equal(results.executions[0].binding, 'BOUND');
  assert.equal(results.obligations.find((item) => item.id === 'structure.types-compatible').result, 'PASS');
  assert.equal(results.types.typeCheck.state, 'UNKNOWN');
  assert.deepEqual(results.types.typeCheck.unchecked, ['src/excluded.ts']);
});
