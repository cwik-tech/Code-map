import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { analysisInputs } from '../lib/inputs.mjs';
import { loadReports } from '../lib/verify-reports.mjs';
import { buildManifest } from '../lib/manifest.mjs';
import { defaults } from '../lib/project.mjs';
import { newAuthorization, saveAuthorization } from '../lib/worker/authorize.mjs';
import { runCommand } from '../lib/worker/run.mjs';
import { loadRun } from '../lib/worker/runs.mjs';
import { parseMypy } from '../lib/adapters/mypy.mjs';

const cli = fileURLToPath(new URL('../bin/code-map.mjs', import.meta.url));
function fixture(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'python-checkers-'))), store = realpathSync(mkdtempSync(join(tmpdir(), 'python-checkers-store-')));
  t.after(() => { rmSync(root, { recursive: true, force: true }); rmSync(store, { recursive: true, force: true }); });
  const put = (name, text) => { mkdirSync(dirname(join(root, name)), { recursive: true }); writeFileSync(join(root, name), text); };
  const git = (...args) => execFileSync('git', ['-C', root, '-c', 'user.name=fixture', '-c', 'user.email=fixture@local', ...args], { encoding: 'utf8', timeout: 10000 }).trim();
  const run = (...args) => spawnSync(process.execPath, [cli, ...args, '--store', store], { cwd: root, encoding: 'utf8', timeout: 30000 });
  const bind = (name, kind, text, exitStatus = '1') => {
    const artifact = `reports/${name}.txt`, manifest = `${artifact}.manifest.json`;
    put(artifact, text);
    put(manifest, JSON.stringify(buildManifest(root, defaults, { artifact, kind, exitStatus, command: ['checker', kind] })));
    return { artifact, manifest };
  };
  put('.gitignore', 'reports/\n'); put('src/leaf.py', 'value: int = "wrong"\n');
  git('init', '-q'); git('add', '.'); git('commit', '-qm', 'base');
  return { root, store, put, git, run, bind };
}

test('Python reports bind exact revisions and inspect lifecycle through a rename', (t) => {
  const f = fixture(t), base = f.git('rev-parse', 'HEAD');
  const before = f.bind('base', 'mypy-text', 'src/leaf.py:1:1: error: Bad type "str"  [assignment]\n');
  f.git('mv', 'src/leaf.py', 'src/moved.py'); f.git('commit', '-qm', 'move');
  const head = f.bind('head', 'mypy-text', 'src/moved.py:2:1: error: Bad type "int"  [assignment]\n');
  const result = f.run('inspect', '--ref', 'HEAD', '--summary', '--base', base, '--compiler-report', head.artifact, '--base-compiler-report', before.artifact);
  assert.equal(result.status, 0, result.stderr);
  const compiler = JSON.parse(result.stdout).compiler;
  assert.deepEqual(compiler.executions.map((entry) => entry.eligible), [true, true]);
  assert.deepEqual(compiler.counts, { new: 0, existing: 1, resolved: 0, unknown: 0 });
  const stale = f.run('inspect', '--ref', 'HEAD', '--summary', '--base', base, '--compiler-report', before.artifact);
  assert.equal(stale.status, 0, stale.stderr);
  assert.equal(JSON.parse(stale.stdout).compiler.executions[0].eligible, false);
  assert.match(JSON.stringify(JSON.parse(stale.stdout).compiler.executions[0].reasons), /side/);
});

test('authorized fake Python tool keeps a bound artifact and refuses different words', async (t) => {
  const f = fixture(t);
  // The real tools are unavailable or environment-dependent. This fixture exercises worker transport only.
  f.put('tool.mjs', `import { mkdirSync, writeFileSync } from 'node:fs';\nmkdirSync('reports', {recursive:true});\nwriteFileSync('reports/mypy.jsonl', JSON.stringify({file:'src/leaf.py',line:1,column:0,severity:'error',code:'assignment',message:'Bad type',hint:null})+'\\n');\nprocess.exitCode=1;\n`);
  f.git('add', '.'); f.git('commit', '-qm', 'fixture tool');
  const command = [process.execPath, 'tool.mjs'], budgets = { wallClockSeconds: 30, memoryMegabytes: 2048, outputMegabytes: 8, concurrency: 1 };
  const authorization = newAuthorization({ repository: f.root, command, budgets, expiresDays: 1, now: new Date() });
  saveAuthorization(f.store, authorization);
  const request = { command, authorization: authorization.id, head: 'HEAD', store: f.store, budgets, kind: 'mypy-json', artifact: 'reports/mypy.jsonl' };
  const result = await runCommand(f.root, defaults, request);
  assert.equal(result.record.exitStatus, 1);
  assert.equal(result.record.policy, 'isolated');
  assert.equal(result.record.source.sha, f.git('rev-parse', 'HEAD'));
  assert.deepEqual(result.record.command, command);
  const stored = loadRun(f.store, result.record.runId, f.root);
  assert.equal(stored.manifest.artifacts[0].kind, 'mypy-json');
  assert.equal(parseMypy(stored.bytes.toString('utf8'), { repository: stored.record.workspace.tree }).report.diagnostics[0].code, 'assignment');
  const inputs = analysisInputs(f.root, defaults, { ref: 'HEAD' }, 'HEAD'), side = { inputs, sha: inputs.sha, analysis: { files: [] } };
  const loaded = loadReports(f.root, [{ run: result.record.runId }], { head: side, base: side }, undefined, f.store);
  assert.equal(loaded.executions[0].eligible, true, JSON.stringify(loaded.executions[0].reasons));
  assert.equal(loaded.compiler.head[0].attestation, 'isolated');
  assert.equal(loaded.compiler.head[0].diagnostics[0].file, 'src/leaf.py');
  assert.deepEqual(loaded.reports.head, []);
  await assert.rejects(runCommand(f.root, defaults, { ...request, command: [...command, '--different'] }), /command|authoriz/i);
});

test('verify consumes mixed bound type reports and keeps ruff outside checks', (t) => {
  const f = fixture(t);
  f.put('src/value.ts', 'export const value = 1;\n'); f.git('add', '.'); f.git('commit', '-qm', 'mixed base');
  const base = f.git('rev-parse', 'HEAD');
  f.put('src/leaf.py', 'value: int = "other"\n'); f.put('src/value.ts', 'export const value = 2;\n');
  f.git('add', '.'); f.git('commit', '-qm', 'mixed head');
  const tsc = f.bind('tsc', 'tsc', 'src/value.ts(1,1): error TS2322: Wrong type.\n');
  const pyright = f.bind('pyright', 'pyright-json', JSON.stringify({ generalDiagnostics: [{ file: 'src/leaf.py', severity: 'error', rule: 'reportAssignmentType', message: 'Wrong type', range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } } }], summary: { errorCount: 1, warningCount: 0, informationCount: 0 } }));
  const ruff = f.bind('ruff', 'ruff-json', JSON.stringify([{ filename: 'src/leaf.py', code: 'F401', message: 'Unused import', location: { row: 1, column: 1 }, end_location: { row: 1, column: 2 }, fix: null }]));
  const request = { requestType: 'code-map-verification-request', schemaVersion: 1, base, head: 'HEAD', intent: 'Change typed values', acceptanceCriteria: [], allowedPaths: ['src/**'], changeType: 'other', profileId: 'static-baseline-v0', ratingRulesVersion: 'ratings-v0', reportInputs: [tsc, pyright, ruff], execution: { enabled: false, authorization: null, budgets: { wallClockSeconds: 30, memoryMegabytes: 512, outputMegabytes: 8, concurrency: 1 } } };
  f.put('reports/request.json', JSON.stringify(request));
  const output = f.run('verify', '--request', 'reports/request.json', '--out-dir', join(f.store, 'verification'));
  assert.equal(output.status, 3, output.stderr);
  const summary = JSON.parse(output.stdout), results = JSON.parse(readFileSync(summary.files.results, 'utf8'));
  assert.deepEqual(results.executions.map((entry) => entry.eligible), [true, true, true]);
  const check = results.obligations.find((item) => item.id === 'structure.types-compatible');
  assert.equal(check.result, 'FAIL');
  assert.match(check.rationale, /TS2322/);
  assert.match(check.rationale, /pyright reportAssignmentType/);
  assert.doesNotMatch(check.rationale, /F401/);
  assert.match(readFileSync(summary.files.report, 'utf8'), /ruff/);
});

test('a bound incomplete Python type artifact keeps the check UNKNOWN instead of not applicable', (t) => {
  const f = fixture(t), base = f.git('rev-parse', 'HEAD');
  f.put('src/leaf.py', 'value = 1\n'); f.git('add', '.'); f.git('commit', '-qm', 'head');
  const invalid = f.bind('invalid-pyright', 'pyright-json', JSON.stringify({ generalDiagnostics: [], summary: { errorCount: 1, warningCount: 0, informationCount: 0 } }));
  const request = { requestType: 'code-map-verification-request', schemaVersion: 1, base, head: 'HEAD', intent: 'Change a Python value', acceptanceCriteria: [], allowedPaths: ['src/**'], changeType: 'other', profileId: 'static-baseline-v0', ratingRulesVersion: 'ratings-v0', reportInputs: [invalid], execution: { enabled: false, authorization: null, budgets: { wallClockSeconds: 30, memoryMegabytes: 512, outputMegabytes: 8, concurrency: 1 } } };
  f.put('reports/request.json', JSON.stringify(request));
  const output = f.run('verify', '--request', 'reports/request.json', '--out-dir', join(f.store, 'verification'));
  assert.equal(output.status, 3, output.stderr);
  const results = JSON.parse(readFileSync(JSON.parse(output.stdout).files.results, 'utf8'));
  assert.equal(results.executions[0].binding, 'BOUND');
  assert.equal(results.executions[0].eligible, false);
  assert.equal(results.obligations.find((item) => item.id === 'structure.types-compatible').result, 'UNKNOWN');
});

test('bound pyright file-level errors reach verification and Markdown without a range', (t) => {
  const f = fixture(t), base = f.git('rev-parse', 'HEAD');
  f.put('src/leaf.py', 'value: int = "other"\n'); f.git('add', '.'); f.git('commit', '-qm', 'head');
  const pyright = f.bind('file-level', 'pyright-json', JSON.stringify({ generalDiagnostics: [
    { file: 'src/leaf.py', severity: 'error', message: 'File-level type error' },
  ], summary: { errorCount: 1, warningCount: 0, informationCount: 0 } }));
  const request = { requestType: 'code-map-verification-request', schemaVersion: 1, base, head: 'HEAD', intent: 'Change a Python value', acceptanceCriteria: [], allowedPaths: ['src/**'], changeType: 'other', profileId: 'static-baseline-v0', ratingRulesVersion: 'ratings-v0', reportInputs: [pyright], execution: { enabled: false, authorization: null, budgets: { wallClockSeconds: 30, memoryMegabytes: 512, outputMegabytes: 8, concurrency: 1 } } };
  f.put('reports/request.json', JSON.stringify(request));
  const output = f.run('verify', '--request', 'reports/request.json', '--out-dir', join(f.store, 'verification'));
  assert.equal(output.status, 3, output.stderr);
  const summary = JSON.parse(output.stdout), results = JSON.parse(readFileSync(summary.files.results, 'utf8'));
  assert.equal(results.executions[0].eligible, true);
  assert.equal(results.obligations.find((item) => item.id === 'structure.types-compatible').result, 'FAIL');
  assert.match(readFileSync(summary.files.report, 'utf8'), /File-level type error/);
});
