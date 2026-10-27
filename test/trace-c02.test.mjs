import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildManifest } from '../lib/manifest.mjs';
import { defaults } from '../lib/project.mjs';
import { parseTsc } from '../lib/adapters/tsc.mjs';
import { newAuthorization, saveAuthorization } from '../lib/worker/authorize.mjs';
import { runCommand } from '../lib/worker/run.mjs';

const cli = fileURLToPath(new URL('../bin/code-map.mjs', import.meta.url));
const modules = dirname(dirname(createRequire(import.meta.url).resolve('typescript/package.json')));
function fixture(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'trace-c02-'))), store = realpathSync(mkdtempSync(join(tmpdir(), 'trace-c02-store-')));
  t.after(() => { rmSync(root, { recursive: true, force: true }); rmSync(store, { recursive: true, force: true }); });
  const put = (path, text) => { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), text); };
  const git = (...args) => execFileSync('git', ['-C', root, '-c', 'user.name=test', '-c', 'user.email=test@local', ...args], { encoding: 'utf8', timeout: 10000 }).trim();
  put('.gitignore', 'reports/\nnode_modules\n*.tsbuildinfo\n');
  put('package.json', '{"private":true,"devDependencies":{"typescript":"6.0.3"}}');
  put('tsconfig.json', '{"compilerOptions":{"strict":true,"noEmit":true},"include":["src"]}');
  put('src/a.ts', 'export const value: number = "wrong";\n');
  git('init', '-q'); git('add', '.'); git('commit', '-qm', 'base');
  symlinkSync(modules, join(root, 'node_modules'));
  return { root, store, put, git };
}

test('installed tsc build diagnostics bind to their revision and a base report cannot stand in for head', (t) => {
  const f = fixture(t), base = f.git('rev-parse', 'HEAD');
  const command = [process.execPath, 'node_modules/typescript/bin/tsc', '-b', '--pretty', 'false'];
  const output = spawnSync(command[0], command.slice(1), { cwd: f.root, encoding: 'utf8', timeout: 30000 });
  assert.equal(output.status, 1, output.stderr);
  assert.deepEqual(parseTsc(output.stdout, { repository: f.root }).report.diagnostics.map(({ file, code }) => [file, code]), [['src/a.ts', 2322]]);
  f.put('reports/base.txt', output.stdout);
  f.put('reports/base.txt.manifest.json', JSON.stringify(buildManifest(f.root, defaults, { artifact: 'reports/base.txt', kind: 'tsc', exitStatus: String(output.status), command })));
  f.put('src/a.ts', 'export const value: number = 1;\n'); f.git('add', '.'); f.git('commit', '-qm', 'head');
  const clean = spawnSync(command[0], command.slice(1), { cwd: f.root, encoding: 'utf8', timeout: 30000 });
  assert.equal(clean.status, 0, clean.stdout + clean.stderr);
  f.put('reports/head.txt', clean.stdout);
  f.put('reports/head.txt.manifest.json', JSON.stringify(buildManifest(f.root, defaults, { artifact: 'reports/head.txt', kind: 'tsc', exitStatus: '0', command })));
  const bound = spawnSync(process.execPath, [cli, 'inspect', '--summary', '--ref', 'HEAD', '--base', base,
    '--compiler-report', 'reports/head.txt', '--base-compiler-report', 'reports/base.txt', '--store', f.store], { cwd: f.root, encoding: 'utf8', timeout: 30000 });
  assert.equal(bound.status, 0, bound.stderr);
  const accepted = JSON.parse(bound.stdout).compiler;
  assert.deepEqual(accepted.executions.map(({ eligible }) => eligible), [true, true]);
  assert.deepEqual(accepted.counts, { new: 0, existing: 0, resolved: 1, unknown: 0 });
  assert.equal(accepted.entries[0].diagnostic.code, 2322);
  const inspected = spawnSync(process.execPath, [cli, 'inspect', '--summary', '--ref', 'HEAD', '--base', base,
    '--compiler-report', 'reports/base.txt', '--store', f.store], { cwd: f.root, encoding: 'utf8', timeout: 30000 });
  assert.equal(inspected.status, 0, inspected.stderr);
  const result = JSON.parse(inspected.stdout).compiler;
  assert.equal(result.executions[0].eligible, false);
  assert.equal(result.executions[0].reasons.some((reason) => reason.key === 'compiler-side'), true, JSON.stringify(result));
  assert.deepEqual(result.counts, { new: 0, existing: 0, resolved: 0, unknown: 0 });
});

test('the authorized restricted worker runs the project installed compiler and refuses different compiler words', async (t) => {
  const f = fixture(t);
  const command = [process.execPath, 'node_modules/typescript/bin/tsc', '--noEmit', '--pretty', 'false'];
  const budgets = { wallClockSeconds: 30, memoryMegabytes: 2048, outputMegabytes: 8, concurrency: 1 };
  const authorization = newAuthorization({ repository: f.root, command, budgets, expiresDays: 1, now: new Date() });
  saveAuthorization(f.store, authorization);
  const request = { command, authorization: authorization.id, head: 'HEAD', store: f.store, budgets };
  const result = await runCommand(f.root, defaults, request);
  assert.equal(result.record.exitStatus, 2);
  assert.equal(result.record.policy, 'isolated');
  assert.equal(result.record.source.sha, f.git('rev-parse', 'HEAD'));
  assert.deepEqual(result.record.command, command);
  const report = parseTsc(readFileSync(result.paths.stdout, 'utf8'), { repository: f.root });
  assert.deepEqual(report.report.diagnostics.map(({ file, code }) => [file, code]), [['src/a.ts', 2322]]);
  await assert.rejects(runCommand(f.root, defaults, { ...request, command: [...command, '--other'] }), /command|authoriz/i);
});
