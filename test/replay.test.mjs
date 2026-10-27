// Replays real fix commits without changing their repository.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('../scripts/replay.mjs', import.meta.url));
test('replay selects fix subjects, uses their parent, preserves dirty files and limits the rows', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'replay-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', ['-C', root, '-c', 'user.name=test', '-c', 'user.email=test@local', ...args], { encoding: 'utf8' }).trim();
  git('init', '-q');
  writeFileSync(join(root, 'a.ts'), 'export const a = 1;\n');
  git('add', '.'); git('commit', '-qm', 'fix root has no parent');
  writeFileSync(join(root, 'a.ts'), 'export const a = 0;\n');
  git('add', '.'); git('commit', '-qm', 'fix older candidate');
  const older = git('rev-parse', 'HEAD');
  writeFileSync(join(root, 'a.ts'), 'export const a = 2;\n');
  git('add', '.'); git('commit', '-qm', 'FIX: update a');
  const head = git('rev-parse', 'HEAD');
  writeFileSync(join(root, 'README.md'), 'notes\n');
  git('add', '.'); git('commit', '-qm', 'docs update\n\nfix in the body is not a fix subject');
  writeFileSync(join(root, 'a.ts'), "import { missing } from './missing';\nexport const a = missing;\n");
  writeFileSync(join(root, 'dirty.txt'), 'keep');
  const before = git('status', '--porcelain');
  const run = spawnSync(process.execPath, [script, '--repo', root, '--limit', '1'], { encoding: 'utf8', timeout: 30000 });
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, new RegExp(head));
  assert.doesNotMatch(run.stdout, new RegExp(older));
  assert.equal(run.stdout.trim().split('\n').length, 2, 'the limit applies to fix subjects only');
  assert.match(run.stdout, /INSUFFICIENT_EVIDENCE/);
  assert.match(run.stdout, /fix\.regression/);
  assert.equal(git('status', '--porcelain'), before);
  assert.equal(readFileSync(join(root, 'dirty.txt'), 'utf8'), 'keep');
});
test('replay rejects an invalid limit before inspecting a repository', () => {
  const run = spawnSync(process.execPath, [script, '--repo', '.', '--limit', '0'], { encoding: 'utf8' });
  assert.equal(run.status, 2);
  assert.match(run.stderr, /Usage:/);
});
