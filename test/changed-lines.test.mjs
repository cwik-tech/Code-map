// The changed lines of the changed code files for the line coverage of code-map verify (changedLines), on a real Git
// repository in a temporary folder. The user's Git settings must not change the lines, and the index must not change.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { changedFiles, changedLines } from '../lib/verify-change.mjs';

const ten = (changes = {}) => Array.from({ length: 10 }, (_, index) => changes[index + 1] ?? `line ${index + 1}`).join('\n') + '\n';

test('changedLines gives the added and modified lines of each changed code file, also with diff.interHunkContext set by the user', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'code-map-changed-lines-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const put = (path, text) => { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), text); };
  const git = (...args) => execFileSync('git', ['-C', root, '-c', 'user.name=test', '-c', 'user.email=test@example.com', ...args], { encoding: 'utf8' }).trim();
  put('src/a.ts', ten()); put('src/gone.ts', 'x\n'); put('test/a.test.ts', ten()); put('README.md', ten());
  git('init', '-q', '-b', 'main'); git('add', '.'); git('commit', '-qm', 'base');
  const base = git('rev-parse', 'HEAD');
  // A user setting that joins hunks with up to 5 unchanged lines between them.
  git('config', 'diff.interHunkContext', '5');
  put('src/a.ts', ten({ 2: 'two', 7: 'seven' })); put('test/a.test.ts', ten({ 3: 'three' })); put('README.md', ten({ 4: 'four' }));
  git('rm', '-q', 'src/gone.ts'); git('add', '.'); git('commit', '-qm', 'head');
  const head = git('rev-parse', 'HEAD');
  const lines = (sha) => Object.fromEntries(changedLines(root, base, sha, changedFiles(root, base, sha).files));
  assert.deepEqual(lines(head), { 'src/a.ts': [2, 7] }, 'a test file, a deleted file and a file that is not code have no changed lines');

  put('src/a.ts', ten({ 2: 'two', 7: 'seven', 9: 'nine' })); put('src/new.ts', 'one\ntwo\nthree\n');
  const index = join(root, '.git', 'index'), before = [readFileSync(index), statSync(index).mtimeMs];
  assert.deepEqual(lines(null), { 'src/a.ts': [2, 7, 9], 'src/new.ts': [1, 2, 3] }, 'each line of an untracked new file is changed');
  assert.deepEqual([readFileSync(index), statSync(index).mtimeMs], before, 'the index did not change');
});
