import assert from 'node:assert/strict';
import { spawnSync, execFileSync } from 'node:child_process';
import { writeFileSync, readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fixture, pythonTest } from './python-fixtures.mjs';

const cli = fileURLToPath(new URL('../bin/code-map.mjs', import.meta.url));
function command(root, args) {
  const result = spawnSync(process.execPath, [cli, ...args], { cwd: root, encoding: 'utf8', timeout: 60000 });
  assert.equal(result.error, undefined, result.stderr);
  return result;
}
pythonTest('Python inspect base and verify retain API changes calls and mixed TypeScript results', (t) => {
  const root = fixture(t, { 'orchard.py': 'def pick(x, y=1) -> int: return x\n', 'user.py': 'from orchard import pick\npick(1, 2)\npick(*args)\n',
    'src/api.ts': 'export function echo(x: string): string { return x; }\n' });
  const store = mkdtempSync(join(tmpdir(), 'python-api-cli-'));
  t.after(() => rmSync(store, { recursive: true, force: true }));
  writeFileSync(join(root, 'orchard.py'), 'def pick(x) -> int: return x\n');
  writeFileSync(join(root, 'src/api.ts'), 'export function echo(x: number): string { return String(x); }\n');
  const output = command(root, ['inspect', '--worktree', '--base', 'HEAD', '--summary', '--store', store]);
  assert.equal(output.status, 0, output.stderr);
  const summary = JSON.parse(output.stdout);
  assert.equal(summary.api.module.counts.changed, 2);
  assert.equal(summary.impact.calls.likelyBreaks, 1);
  assert.equal(summary.impact.calls.unknown, 1);
  const request = join(store, 'request.json');
  writeFileSync(request, JSON.stringify({ requestType: 'code-map-verification-request', schemaVersion: 1, base: 'HEAD', head: 'worktree',
    intent: 'Check changed Python and TypeScript APIs', acceptanceCriteria: [], allowedPaths: ['orchard.py', 'src/api.ts'], changeType: 'feature',
    profileId: 'static-baseline-v0', ratingRulesVersion: 'ratings-v0', reportInputs: [],
    execution: { enabled: false, authorization: null, budgets: { wallClockSeconds: 600, memoryMegabytes: 2048, outputMegabytes: 64, concurrency: 1 } } }));
  const verified = command(root, ['verify', '--request', request, '--store', store, '--out-dir', join(store, 'out')]);
  assert.ok([0, 1, 2, 3].includes(verified.status), verified.stderr);
  const report = JSON.parse(readFileSync(JSON.parse(verified.stdout).files.results, 'utf8'));
  assert.ok(report.pythonApi.items.some((i) => i.name === 'pick' && i.status === 'CHANGED'));
  assert.equal(report.pythonApi.calls.sites.find((s) => s.line === 2).compatibility, 'INCOMPATIBLE');
  assert.equal(execFileSync('git', ['-C', root, 'status', '--short'], { encoding: 'utf8' }).trim().split('\n').length, 2);
});

pythonTest('Python inspect follows a real Git rename for a changed signature', (t) => {
  const header = Array.from({ length: 30 }, (_, i) => `# Stable fixture header ${i}`).join('\n');
  const root = fixture(t, { 'before.py': `${header}\ndef pick(x: int) -> int: return x\n`, 'user.py': 'from after import pick\npick(1)\n' });
  const store = mkdtempSync(join(tmpdir(), 'python-api-rename-'));
  t.after(() => rmSync(store, { recursive: true, force: true }));
  execFileSync('git', ['-C', root, 'mv', 'before.py', 'after.py']);
  writeFileSync(join(root, 'after.py'), `${header}\ndef pick(x: int, needed: str) -> int: return x\n`);
  const result = command(root, ['inspect', '--worktree', '--base', 'HEAD', '--summary', '--store', store]);
  assert.equal(result.status, 0, result.stderr);
  const summary = JSON.parse(result.stdout);
  const item = summary.api.module.examples.find((i) => i.name === 'pick');
  assert.equal(item.status, 'CHANGED');
  assert.equal(item.basePath, 'before.py');
  assert.equal(item.path, 'after.py');
  assert.equal(summary.impact.calls.likelyBreaks, 1);
});
