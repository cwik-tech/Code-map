import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fixture, pythonTest } from './python-fixtures.mjs';

const cli = fileURLToPath(new URL('../bin/code-map.mjs', import.meta.url));
pythonTest('Python package and orphan findings reach inspect gaps and static verify', (t) => {
  const root = fixture(t, { 'requirements.txt': 'invented-core\n', 'uv.lock': '[[package]]\nname="invented-missing"\n', 'main.py': 'import invented_core\n', 'plugins/one.py': 'pass\n' });
  const work = mkdtempSync(join(tmpdir(), 'python-package-report-'));
  t.after(() => rmSync(work, { recursive: true, force: true }));
  writeFileSync(join(root, 'main.py'), 'import invented_missing\n');
  writeFileSync(join(root, 'idle.py'), 'pass\n');
  writeFileSync(join(root, 'loader.py'), 'import importlib\nimportlib.import_module("plugins." + name)\n');
  execFileSync('git', ['-C', root, 'add', '.']);
  const inspect = JSON.parse(execFileSync(process.execPath, [cli, 'inspect', '--worktree', '--summary', '--store', join(work, 'store')], { cwd: root, encoding: 'utf8', timeout: 30000 }));
  assert.ok(inspect.findings.byRule.some((r) => r.ruleId === 'PACKAGE-UNDECLARED'));
  assert.ok(inspect.findings.byRule.some((r) => r.ruleId === 'FILE-ORPHANED'));
  assert.ok(inspect.gaps.some((g) => g.key === 'orphansUnknown'));
  const request = { requestType: 'code-map-verification-request', schemaVersion: 1, base: 'HEAD', head: 'worktree', intent: 'Exercise Python package reporting.',
    acceptanceCriteria: [], allowedPaths: ['**'], changeType: 'other', profileId: 'static-baseline-v0', ratingRulesVersion: 'ratings-v0', reportInputs: [],
    execution: { enabled: false, authorization: null, budgets: { wallClockSeconds: 60, memoryMegabytes: 512, outputMegabytes: 8, concurrency: 1 } } };
  writeFileSync(join(work, 'request.json'), JSON.stringify(request));
  const child = spawnSync(process.execPath, [cli, 'verify', '--request', join(work, 'request.json'), '--store', join(work, 'store'), '--out-dir', join(work, 'out')], { cwd: root, encoding: 'utf8', timeout: 30000 });
  assert.notEqual(child.status, 4, child.stderr);
  const result = JSON.parse(readFileSync(JSON.parse(child.stdout).files.results, 'utf8'));
  const stored = JSON.parse(execFileSync(process.execPath, [cli, 'inspect', '--analysis', result.head.analysisId, '--findings', '--store', join(work, 'store')], { cwd: root, encoding: 'utf8', timeout: 30000 }));
  assert.ok(stored.page.items.some((f) => f.ruleId === 'PACKAGE-UNDECLARED'));
  assert.ok(stored.page.items.some((f) => f.ruleId === 'FILE-ORPHANED'));
  assert.equal(result.completeness.find((r) => r.stack === 'Python').parsed, 4);
  assert.ok(result.gaps.some((g) => g.key === 'orphansUnknown'));
});
