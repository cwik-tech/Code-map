import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chatWorkspace } from '../lib/snapshot.mjs';

function fixture(t) {
  const folder = mkdtempSync(join(tmpdir(), 'code-map-snapshot-consistency-'));
  const variable = process.platform === 'win32' ? 'TEMP' : 'TMPDIR', previous = process.env[variable];
  process.env[variable] = join(folder, 'temporary');
  mkdirSync(process.env[variable]);
  t.after(() => {
    if (previous === undefined) delete process.env[variable]; else process.env[variable] = previous;
    rmSync(folder, { recursive: true, force: true });
  });
  const repository = join(folder, 'repository'); mkdirSync(repository);
  const git = (...args) => execFileSync('git', ['-C', repository, '-c', 'user.name=test', '-c', 'user.email=test@example.com',
    '-c', 'commit.gpgsign=false', ...args], { encoding: 'utf8', timeout: 5000 }).trim();
  git('init', '-q', '-b', 'main');
  const write = (text) => writeFileSync(join(repository, 'source.mjs'), text);
  write('export const value = "committed";\n');
  git('add', '.'); git('commit', '-qm', 'initial');
  return { repository, git, write, sha: git('rev-parse', 'HEAD'), read: (place) => readFileSync(join(place.directory, 'source.mjs'), 'utf8') };
}

test('chat for HEAD reads the commit despite staged and unstaged edits', (t) => {
  const f = fixture(t);
  f.write('export const value = "staged";\n'); f.git('add', '.');
  f.write('export const value = "unstaged";\n');
  const before = f.git('status', '--porcelain');
  const place = chatWorkspace(f.repository, f.sha, 'HEAD', false);
  assert.equal(f.read(place), 'export const value = "committed";\n');
  assert.equal(f.git('status', '--porcelain'), before, 'snapshot preparation preserves the index and worktree');
});

test('chat for a commit remains unchanged when the live repository is edited later', (t) => {
  const f = fixture(t), place = chatWorkspace(f.repository, f.sha, 'HEAD', false);
  f.write('export const value = "later edit";\n');
  assert.equal(f.read(place), 'export const value = "committed";\n');
  assert.equal(f.read(chatWorkspace(f.repository, f.sha, 'HEAD', false)), 'export const value = "committed";\n');
});

test('explicit worktree chat continues to read the live repository', (t) => {
  const f = fixture(t), place = chatWorkspace(f.repository, f.sha, 'working tree', true);
  f.write('export const value = "working tree";\n');
  assert.equal(place.directory, f.repository);
  assert.equal(f.read(place), 'export const value = "working tree";\n');
});
