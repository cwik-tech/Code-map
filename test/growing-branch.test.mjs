// Without --ref, Code-map maps the local branch whose source changed most recently. A branch can have the name of a folder.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { growingBranch } from '../lib/git.mjs';

test('a branch with the name of a folder is not read as a path, so the branch choice does not fail', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'code-map-branch-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', ['-C', root, '-c', 'user.name=test', '-c', 'user.email=test@example.com', ...args], { encoding: 'utf8', env: { ...process.env, GIT_COMMITTER_DATE: date } });
  let date = '2026-01-01T00:00:00Z';
  mkdirSync(join(root, 'electron')); writeFileSync(join(root, 'electron/main.ts'), 'export const a = 1;\n');
  git('init', '-q', '-b', 'main'); git('add', '.'); git('commit', '-qm', 'one');
  git('branch', 'electron');
  date = '2026-01-02T00:00:00Z';
  writeFileSync(join(root, 'electron/main.ts'), 'export const a = 2;\n'); git('commit', '-qam', 'two on main');
  assert.equal(growingBranch(root, ['.']), 'main');
});
