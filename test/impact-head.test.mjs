// Head text reads must stay inside the repository, including tracked paths below a replaced folder.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { readHead } from '../lib/impact/head-files.mjs';

test('head text reads skip a tracked file below a symlinked folder', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'code-map-impact-head-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const repository = join(root, 'repo'), outside = join(root, 'outside');
  mkdirSync(join(repository, 'docs'), { recursive: true });
  mkdirSync(outside);
  writeFileSync(join(repository, 'docs/note.md'), 'Inside.');
  execFileSync('git', ['init', '-q', repository]);
  execFileSync('git', ['-C', repository, 'add', '.']);
  execFileSync('git', ['-C', repository, '-c', 'user.name=test', '-c', 'user.email=test@local', 'commit', '-qm', 'base']);
  rmSync(join(repository, 'docs'), { recursive: true });
  writeFileSync(join(outside, 'note.md'), 'Private outside text.');
  symlinkSync(outside, join(repository, 'docs'));
  const result = readHead({ inputs: { repository, selector: { worktree: true } } }, (path) => path.endsWith('.md'));
  assert.deepEqual([...result.texts], [], 'a tracked descendant must not follow the directory symlink');
});
