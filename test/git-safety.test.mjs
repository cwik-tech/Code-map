// Code-map reads Git and never writes into the mapped repository or its .git folder. It keeps the path names that Git
// quotes (non-ASCII letters, a double quote), and its rename list says when Git skipped rename detection.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readChanges, readCoChanges, readFixCommits } from '../lib/changes.mjs';
import { gitRenames } from '../lib/compare-git.mjs';
import { sourceReader } from '../lib/git.mjs';
import { readHistory } from '../lib/history.mjs';

const cli = fileURLToPath(new URL('../bin/code-map.mjs', import.meta.url));
const keep = (path) => path.startsWith('src/');

function repository(t) {
  const root = mkdtempSync(join(tmpdir(), 'code-map-git-safety-'));
  const store = mkdtempSync(join(tmpdir(), 'code-map-git-safety-store-'));
  t.after(() => { rmSync(root, { recursive: true, force: true }); rmSync(store, { recursive: true, force: true }); });
  const put = (path, text) => { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), text); };
  const move = (from, to) => { mkdirSync(dirname(join(root, to)), { recursive: true }); renameSync(join(root, from), join(root, to)); };
  const git = (...args) => execFileSync('git', ['-C', root, '-c', 'user.name=test', '-c', 'user.email=test@example.com', ...args], { encoding: 'utf8' });
  git('init', '-q', '-b', 'main');
  return { root, store, put, move, git };
}

const run = (root, args) => spawnSync(process.execPath, [cli, ...args], { cwd: root, encoding: 'utf8', timeout: 60000 });
function json(output) {
  assert.equal(output.status, 0, output.stderr);
  return JSON.parse(output.stdout);
}

/** The time, size and content hash of every file under .git. */
function gitFolder(root) {
  const state = {};
  const walk = (folder) => {
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      const path = join(folder, entry.name);
      if (entry.isDirectory()) walk(path);
      else { const info = statSync(path); state[relative(root, path)] = `${info.mtimeMs} ${info.size} ${createHash('sha256').update(readFileSync(path)).digest('hex')}`; }
    }
  };
  walk(join(root, '.git'));
  return state;
}

const changed = (before, after) => [...new Set([...Object.keys(before), ...Object.keys(after)])].filter((path) => before[path] !== after[path]).sort();

/** New stat data with the same content: Git must read each file again, and a plain `git diff` writes the index. */
function makeStatDirty(root, git) {
  const old = new Date('2001-02-03T04:05:06Z');
  for (const path of git('ls-files', '-z').split('\0').filter(Boolean)) { try { utimesSync(join(root, path), old, old); } catch { /* moved away */ } }
}

test('acceptance: worktree inspections and a worktree rename comparison write nothing under .git, also when the index is stat-dirty', (t) => {
  const { root, store, put, move, git } = repository(t);
  put('.code-map.json', JSON.stringify({ rules: [] }));
  put('src/lib/name.ts', 'export const keep = 1;\nexport const spare = 2;\n');
  put('src/lib/user.ts', "import { keep } from './name';\nexport const one = keep;\n");
  put('src/a.ts', 'export const a = 1;\n');
  git('add', '.'); git('commit', '-qm', 'base');
  move('src/lib/name.ts', 'src/new/name.ts');
  put('src/lib/user.ts', "import { keep } from '../new/name';\nexport const one = keep;\n");
  const marker = join(store, 'hook-ran');
  writeFileSync(join(root, '.git/hooks/post-index-change'), `#!/bin/sh\necho ran >> "${marker}"\n`, { mode: 0o755 });
  makeStatDirty(root, git);
  const before = gitFolder(root);

  const classic = json(run(root, ['inspect', '--worktree', '--compact']));
  assert.ok(classic.files.some((file) => file.path === 'src/new/name.ts'));
  const summary = json(run(root, ['inspect', '--summary', '--worktree', '--base', 'HEAD', '--store', store]));
  const renames = gitRenames(root, 'HEAD', null);
  const changes = readChanges(root, git('rev-parse', 'HEAD').trim(), ['src'], keep, true);
  assert.deepEqual(changed(before, gitFolder(root)), [], 'nothing under .git changed');
  assert.equal(existsSync(marker), false, 'the write of the private index runs no hook');
  assert.equal(summary.comparison.state, 'COMPARABLE');
  assert.deepEqual(renames.renames, [{ from: 'src/lib/name.ts', to: 'src/new/name.ts', similarity: 100 }]);
  assert.deepEqual(changes.uncommitted, ['src/lib/name.ts', 'src/lib/user.ts', 'src/new/name.ts'], 'stat-dirty files are not changes');

  spawnSync('git', ['-C', root, 'diff', '--quiet', 'HEAD']);
  assert.ok(changed(before, gitFolder(root)).includes('.git/index'), 'the fixture is stat-dirty: a plain git diff rewrites .git/index');
});

test('names with non-ASCII letters or a double quote stay in a committed snapshot, its history and its changes', (t) => {
  const { root, put, git } = repository(t);
  put('src/a.ts', "import { z } from './zé';\nimport { q } from './q\"x';\nexport const a = z + q;\n");
  put('src/zé.ts', 'export const z = 1;\n');
  put('src/q"x.ts', 'export const q = 2;\n');
  git('add', '.'); git('commit', '-qm', 'base');
  git('checkout', '-q', '-b', 'task');
  put('src/zé.ts', 'export const z = 1;\nexport const y = 2;\n');
  put('src/q"x.ts', 'export const q = 2;\nexport const r = 3;\n');
  git('add', '.'); git('commit', '-qm', 'Fix the parser of zé');
  const sha = git('rev-parse', 'HEAD').trim();

  const reader = sourceReader(root, 'HEAD');
  assert.deepEqual(reader.list().sort(), ['src/a.ts', 'src/q"x.ts', 'src/zé.ts']);
  assert.equal(reader.read(['src/zé.ts']).get('src/zé.ts'), 'export const z = 1;\nexport const y = 2;\n');
  const sizes = readHistory(root, sha, ['src'], keep, 5).at(-1).sizes;
  assert.deepEqual([sizes.get('src/zé.ts'), sizes.get('src/q"x.ts')], [2, 2]);
  assert.deepEqual(readCoChanges(root, sha, ['src'], keep, new Set(['src/a.ts', 'src/zé.ts', 'src/q"x.ts'])).changes, { 'src/a.ts': 1, 'src/zé.ts': 2, 'src/q"x.ts': 2 });
  assert.deepEqual(readFixCommits(root, sha, keep, () => false).commits.map((commit) => commit.sources), [['src/q"x.ts', 'src/zé.ts']]);
  const changes = readChanges(root, sha, ['src'], keep, false);
  assert.deepEqual(changes.commits.map((commit) => commit.files.sort()), [['src/q"x.ts', 'src/zé.ts'], ['src/a.ts', 'src/q"x.ts', 'src/zé.ts']]);
  assert.deepEqual(changes.base.files, ['src/q"x.ts', 'src/zé.ts']);

  const report = json(run(root, ['inspect', '--ref', 'HEAD', '--compact']));
  assert.deepEqual(report.files.map((file) => file.path).sort(), ['src/a.ts', 'src/q"x.ts', 'src/zé.ts']);
  assert.deepEqual(report.files.find((file) => file.path === 'src/zé.ts').importers.length, 1);
});

test('names with non-ASCII letters or a double quote stay in a working-tree snapshot and in its uncommitted changes', (t) => {
  const { root, put, git } = repository(t);
  put('src/zé.ts', 'export const z = 1;\n');
  put('src/q"x.ts', 'export const q = 2;\n');
  put('src/plain.ts', 'export const p = 3;\n');
  git('add', '.'); git('commit', '-qm', 'base');
  put('src/zé.ts', 'export const z = 1;\nexport const y = 2;\n');
  put('src/né"w.ts', "import { z } from './zé';\nexport const n = z;\n");

  assert.deepEqual(sourceReader(root, null).list().sort(), ['src/né"w.ts', 'src/plain.ts', 'src/q"x.ts', 'src/zé.ts']);
  assert.deepEqual(readChanges(root, git('rev-parse', 'HEAD').trim(), ['src'], keep, true).uncommitted, ['src/né"w.ts', 'src/zé.ts']);
  const report = json(run(root, ['inspect', '--worktree', '--compact']));
  assert.deepEqual(report.files.map((file) => file.path).sort(), ['src/né"w.ts', 'src/plain.ts', 'src/q"x.ts', 'src/zé.ts']);
});

test('a rename of a name with non-ASCII letters or a double quote keeps both names', (t) => {
  const { root, put, git } = repository(t);
  put('src/zé.ts', 'export const z = 1;\nexport const y = 2;\n');
  git('add', '.'); git('commit', '-qm', 'base');
  git('mv', 'src/zé.ts', 'src/ñ"é.ts'); git('commit', '-qm', 'move');
  assert.deepEqual(gitRenames(root, 'HEAD~1', 'HEAD'), { renames: [{ from: 'src/zé.ts', to: 'src/ñ"é.ts', similarity: 100 }], complete: true });
});

test('gitRenames says that the list is not complete when Git skips rename detection because of its rename limit', (t) => {
  const { root, put, git } = repository(t);
  for (const i of [1, 2, 3]) put(`src/old/f${i}.ts`, `export const keep${i} = ${i};\nexport const spare${i} = ${i};\nexport const more${i} = ${i};\n`);
  git('add', '.'); git('commit', '-qm', 'base');
  for (const i of [1, 2, 3]) { mkdirSync(join(root, 'src/new'), { recursive: true }); git('mv', `src/old/f${i}.ts`, `src/new/g${i}.ts`); put(`src/new/g${i}.ts`, `${readFileSync(join(root, `src/new/g${i}.ts`), 'utf8')}// moved\n`); }
  git('add', '.'); git('commit', '-qm', 'move');
  const full = gitRenames(root, 'HEAD~1', 'HEAD');
  assert.deepEqual([full.complete, full.renames.map((item) => item.to)], [true, ['src/new/g1.ts', 'src/new/g2.ts', 'src/new/g3.ts']]);
  git('config', 'diff.renameLimit', '1');
  assert.deepEqual(gitRenames(root, 'HEAD~1', 'HEAD'), { renames: [], complete: false });
  git('reset', '-q', '--soft', 'HEAD~1');
  assert.deepEqual(gitRenames(root, 'HEAD', null), { renames: [], complete: false }, 'also for a working-tree head');
});

test('a move that is not staged pairs a deleted tracked file with an untracked file of the same content', (t) => {
  const { root, store, put, move, git } = repository(t);
  put('.code-map.json', JSON.stringify({ rules: [] }));
  put('src/lib/name.ts', 'export const keep = 1;\nexport const spare = 2;\n');
  put('src/lib/user.ts', "import { keep } from './name';\nexport const one = keep;\n");
  put('src/lib/edited.ts', 'export const e = 1;\n');
  git('add', '.'); git('commit', '-qm', 'base');
  move('src/lib/name.ts', 'src/new/name.ts');
  put('src/lib/user.ts', "import { keep } from '../new/name';\nexport const one = keep;\n");
  move('src/lib/edited.ts', 'src/new/edited.ts');
  put('src/new/edited.ts', 'export const e = 2;\n');

  assert.deepEqual(gitRenames(root, 'HEAD', null), { renames: [{ from: 'src/lib/name.ts', to: 'src/new/name.ts', similarity: 100 },
    { from: 'src/lib/edited.ts', to: 'src/new/edited.ts', similarity: 0 }], complete: true }, 'an edited move pairs by its unique file name, with an unknown similarity');
  const summary = json(run(root, ['inspect', '--summary', '--worktree', '--base', 'HEAD', '--store', store]));
  assert.equal(summary.comparison.state, 'COMPARABLE');
  const spare = summary.findings.items.find((item) => item.location.symbol === 'spare');
  assert.deepEqual([spare.location.path, spare.baseline], ['src/new/name.ts', 'EXISTING'], 'the moved finding is not NEW');
  assert.equal(summary.comparison.counts.resolved, 0);
});

test('the pairing of a move that is not staged starts no filter driver and writes no object', (t) => {
  const { root, move, put, git } = repository(t);
  const marker = join(mkdtempSync(join(tmpdir(), 'code-map-git-safety-filter-')), 'ran');
  t.after(() => rmSync(dirname(marker), { recursive: true, force: true }));
  put('.gitattributes', '*.dat filter=probe\n');
  put('src/data.dat', 'payload\n');
  git('config', 'filter.probe.clean', `sh -c 'echo ran >> "${marker}"; cat'`);
  git('add', '.'); git('commit', '-qm', 'base');
  rmSync(marker, { force: true });
  move('src/data.dat', 'src/moved/data.dat');
  const before = gitFolder(root);
  assert.deepEqual(gitRenames(root, 'HEAD', null), { renames: [], complete: false }, 'a file with a filter driver is not hashed, so the move stays unknown');
  assert.deepEqual([existsSync(marker), changed(before, gitFolder(root))], [false, []]);
});

test('uncommitted changes depend on the working-tree content, not on the index', (t) => {
  const { root, put, move, git } = repository(t);
  put('src/a.ts', 'export const a = 1;\n'); put('src/b.ts', 'export const b = 1;\n'); put('src/c.ts', 'export const c = 1;\n');
  git('add', '.'); git('commit', '-qm', 'fixture');
  const uncommitted = () => readChanges(root, git('rev-parse', 'HEAD').trim(), ['src'], keep, true).uncommitted;
  git('rm', '-q', '--cached', 'src/a.ts');
  assert.deepEqual(uncommitted(), [], 'a file removed only from the index is unchanged in the working tree');
  git('reset', '-q');
  move('src/b.ts', 'src/z.ts');
  const unstaged = uncommitted();
  git('add', '-A');
  assert.deepEqual(uncommitted(), unstaged, 'staging a move changes nothing in the working tree');
  assert.deepEqual(unstaged, ['src/b.ts', 'src/z.ts']);
  put('src/c.ts', 'export const c = 2;\n');
  assert.deepEqual(uncommitted(), ['src/b.ts', 'src/c.ts', 'src/z.ts']);
});

test('a file name with a line break is left out, so the blob reader gives each file its own content', { skip: process.platform === 'win32' && 'needs a line break in a file name' }, (t) => {
  const { root, put, git } = repository(t);
  put('src/a.ts', 'export const a = 1;\n'); put('src/odd\nname.ts', 'export const odd = 1;\n'); put('src/z.ts', 'export const z = 1;\n');
  git('add', '.'); git('commit', '-qm', 'fixture');
  for (const reader of [sourceReader(root, 'HEAD'), sourceReader(root, null)]) {
    const files = reader.list();
    assert.deepEqual(files.filter((path) => path.startsWith('src/')), ['src/a.ts', 'src/z.ts']);
    assert.equal(reader.read(files.filter((path) => path.startsWith('src/'))).get('src/z.ts'), 'export const z = 1;\n');
  }
});

test('an unstaged edited rename with a new basename leaves unmatched findings unknown', (t) => {
  const { root, store, put, move, git } = repository(t);
  put('src/old.ts', 'export const keep = 1;\nexport const spare = 1;\n');
  put('src/user.ts', "import { keep } from './old'; export const user = keep;\n");
  git('add', '.'); git('commit', '-qm', 'base');
  move('src/old.ts', 'src/new.ts');
  put('src/new.ts', 'export const keep = 2;\nexport const fresh = 2;\n');
  put('src/user.ts', "import { keep } from './new'; export const user = keep;\n");
  const summary = json(run(root, ['inspect', '--summary', '--worktree', '--base', 'HEAD', '--store', store]));
  assert.equal(summary.comparison.counts.new, 0);
  assert.equal(summary.comparison.counts.resolved, 0);
  assert.equal(summary.findings.items.find((item) => item.location.symbol === 'fresh').baseline, 'UNKNOWN');
  assert.equal(gitRenames(root, 'HEAD', null).complete, false);
});
