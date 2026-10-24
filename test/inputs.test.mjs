import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { analysisId, analysisInputs, changedInputs, parseStatus } from '../lib/inputs.mjs';
import { loadConfig } from '../lib/project.mjs';

function repository(t, files, init = []) {
  const root = mkdtempSync(join(tmpdir(), 'code-map-inputs-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const put = (path, text) => { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), text); };
  for (const [path, text] of Object.entries(files)) put(path, text);
  const git = (...args) => execFileSync('git', ['-C', root, '-c', 'user.name=test', '-c', 'user.email=test@example.com', ...args], { encoding: 'utf8' });
  git('init', '-q', ...init); git('add', '.'); git('commit', '-qm', 'fixture');
  const inputs = (options = { worktree: true }) => analysisInputs(root, loadConfig(root), options, options.worktree ? null : 'HEAD');
  const id = () => analysisId(inputs());
  return { root, put, git, inputs, id };
}

test('status parsing reads the original path of a rename in either status column, so the next entry keeps its own status', () => {
  const entries = parseStatus(' R new.ts\0Cfg.ts\0 M src/zz.ts\0R  moved.ts\0old.ts\0?? notes.md\0');
  assert.deepEqual(entries, [
    { status: ' R', path: 'new.ts', from: 'Cfg.ts' },
    { status: ' M', path: 'src/zz.ts', from: null },
    { status: 'R ', path: 'moved.ts', from: 'old.ts' },
    { status: '??', path: 'notes.md', from: null },
  ]);
});

test('an edit of a file that a symlink points to changes the analysis ID', { skip: process.platform === 'win32' && 'needs symlinks' }, (t) => {
  const { root, put, git, id } = repository(t, { '.gitignore': 'shared/\n', 'shared/real.ts': 'export const a = 1;\n', 'src/index.ts': "import { a } from './link';\nexport const b = a;\n" });
  symlinkSync('../shared/real.ts', join(root, 'src/link.ts'));
  git('add', 'src/link.ts'); git('commit', '-qm', 'link');
  const before = id();
  put('shared/real.ts', 'export const a = 2;\nexport const extra = 3;\n');
  assert.notEqual(id(), before);
});

test('checked Markdown changes the analysis ID, generated pages do not, and new files and data files change it', (t) => {
  const { put, id } = repository(t, { 'README.md': '# fixture\n', 'docs/map.html': '<p>old</p>\n', 'src/index.ts': 'export const a = 1;\n' });
  const before = id();
  put('README.md', '# edited\n');
  const checked = id();
  assert.notEqual(checked, before, 'checked Markdown is an analysis input');
  put('docs/map.html', '<p>new</p>\n');
  assert.equal(id(), checked, 'a generated page does not change what the analysis reads');
  put('notes.md', 'new file\n');
  const withNote = id();
  assert.notEqual(withNote, before, 'a new file can change import resolution');
  put('src/data.json', '{"a":1}\n');
  assert.notEqual(id(), withNote, 'JSON files are read as configuration');
});

test('staging a change without an edit keeps the analysis ID, because the collector reads the working tree and not the index', (t) => {
  const { put, git, inputs, id } = repository(t, { 'src/a.ts': 'export const a = 1;\n', 'src/b.ts': 'export const b = 1;\n' });
  put('src/b.ts', 'export const b = 2;\n');
  put('src/c.ts', 'export const c = 1;\n');
  put('notes.md', 'new file\n');
  const before = id(), content = inputs().worktree.contentDigest;
  git('add', 'src/b.ts', 'src/c.ts', 'notes.md');
  assert.equal(id(), before, 'a modified file and new files that are staged');
  git('rm', '-q', '--cached', 'src/a.ts');
  assert.equal(id(), before, 'a file that only leaves the index is still in the working tree');
  assert.equal(inputs().worktree.contentDigest, content);
});

test('an edit of a file marked assume-unchanged or skip-worktree changes the analysis ID, because the collector reads it', (t) => {
  const { put, git, id } = repository(t, { 'src/a.ts': 'export const a = 1;\n', 'src/b.ts': 'export const b = 1;\n' });
  const clean = id();
  git('update-index', '--assume-unchanged', 'src/a.ts');
  git('update-index', '--skip-worktree', 'src/b.ts');
  assert.equal(id(), clean, 'a flag without an edit changes nothing that the collector reads');
  put('src/a.ts', 'export const a = 2;\nexport const extra = 3;\n');
  const edited = id();
  assert.notEqual(edited, clean);
  put('src/b.ts', 'export const b = 2;\n');
  assert.notEqual(id(), edited);
});

test('the content digest covers every changed file, also snapshots and fixtures, and the analysis ID leaves it out', (t) => {
  const { put, git, inputs } = repository(t, { '.gitignore': '.env.test\n', '__snapshots__/index.test.ts.snap': 'v1\n', 'fixture.txt': 'v1\n', 'src/index.ts': 'export const a = 1;\n' });
  const clean = inputs();
  assert.equal(clean.worktree.contentDigest, null, 'a clean working tree has no content digest, as a run manifest of its commit');
  put('__snapshots__/index.test.ts.snap', 'v2\n');
  put('fixture.txt', 'v2\n');
  const v2 = inputs();
  put('fixture.txt', 'v3\n');
  const v3 = inputs();
  assert.match(v2.worktree.contentDigest, /^[0-9a-f]{64}$/);
  assert.notEqual(v3.worktree.contentDigest, v2.worktree.contentDigest);
  assert.equal(new Set([clean, v2, v3].map(analysisId)).size, 1, 'an edit of a file that the analysis does not read keeps the ID');
  assert.deepEqual(changedInputs(clean, v3), [], 'and the stored analysis stays current');
  put('.env.test', 'TOKEN=1\n');
  assert.equal(inputs().worktree.contentDigest, v3.worktree.contentDigest, 'ignored files are left out, as in the map');
  git('add', '.');
  put('fixture.txt', 'v1\n');
  put('__snapshots__/index.test.ts.snap', 'v1\n');
  assert.equal(inputs().worktree.contentDigest, null, 'content that is the same as in the commit does not count, whatever the index holds');
});

test('deepening a shallow clone changes the analysis ID, because co-change and fix findings come from the history', (t) => {
  const { root, put, git } = repository(t, { 'src/a.ts': 'export const a = 0;\n' });
  for (const number of [1, 2, 3]) { put('src/a.ts', `export const a = ${number};\n`); git('commit', '-qam', `fix bug number ${number}`); }
  const clone = mkdtempSync(join(tmpdir(), 'code-map-shallow-'));
  t.after(() => rmSync(clone, { recursive: true, force: true }));
  execFileSync('git', ['clone', '-q', '--depth', '1', `file://${root}`, clone]);
  const inputs = () => analysisInputs(clone, loadConfig(clone), { ref: 'HEAD' }, 'HEAD');
  const shallow = inputs();
  assert.equal(shallow.history.shallow, true);
  execFileSync('git', ['-C', clone, 'fetch', '-q', '--deepen', '1']);
  const deeper = inputs();
  assert.notEqual(analysisId(deeper), analysisId(shallow));
  assert.deepEqual(changedInputs(shallow, deeper), ['history']);
  execFileSync('git', ['-C', clone, 'fetch', '-q', '--unshallow']);
  const full = inputs();
  assert.deepEqual(full.history, { shallow: false, boundary: null, grafts: null, replace: null });
  assert.notEqual(analysisId(full), analysisId(deeper));
});

test('in a SHA-256 repository the commit ID has 64 characters, and a flag without an edit still counts as no change', (t) => {
  const { put, git, inputs } = repository(t, { 'src/a.ts': 'export const a = 1;\n', 'fixture.txt': 'v1\n' }, ['--object-format=sha256']);
  git('update-index', '--assume-unchanged', 'src/a.ts');
  const clean = inputs();
  assert.match(clean.sha, /^[0-9a-f]{64}$/);
  assert.deepEqual([clean.worktree.digest, clean.worktree.contentDigest], [null, null]);
  put('fixture.txt', 'v2\n');
  assert.match(inputs().worktree.contentDigest, /^[0-9a-f]{64}$/);
});

test('a symlink to an ignored file binds run manifests through its target, and a symlink to a committed file keeps a clean tree clean', { skip: process.platform === 'win32' && 'needs symlinks' }, (t) => {
  const { root, put, git } = repository(t, { '.gitignore': 'shared/\n', 'shared/fixture.txt': 'one\n', 'src/real.ts': 'export const a = 1;\n' });
  symlinkSync('../shared/fixture.txt', join(root, 'src/fixture.txt'));
  symlinkSync('real.ts', join(root, 'src/alias.ts'));
  git('add', '.'); git('commit', '-qm', 'links');
  const inputs = () => analysisInputs(root, loadConfig(root), { worktree: true }, null).worktree;
  const clean = inputs();
  put('shared/fixture.txt', 'two\n');
  assert.notEqual(inputs().contentDigest, clean.contentDigest, 'the ignored target of a tracked symlink counts for run manifests');
  put('shared/fixture.txt', 'one\n');
  rmSync(join(root, 'src/fixture.txt')); git('rm', '-q', '--cached', 'src/fixture.txt'); git('commit', '-qm', 'drop the ignored link');
  assert.deepEqual([inputs().digest, inputs().contentDigest], [null, null], 'a symlink to a committed file adds nothing to a clean tree');
});

test('grafts and replace refs change the history input, because they change the history that Git shows', (t) => {
  const { root, put, git } = repository(t, { 'src/a.ts': 'export const a = 1;\n' });
  put('src/a.ts', 'export const a = 2;\n'); git('commit', '-qam', 'second');
  const history = () => analysisInputs(root, loadConfig(root), { ref: 'HEAD' }, 'HEAD').history;
  const before = history();
  const [head, parent] = [git('rev-parse', 'HEAD').trim(), git('rev-parse', 'HEAD~1').trim()];
  git('replace', '--graft', head);
  const replaced = history();
  assert.notDeepEqual(replaced, before);
  git('replace', '-d', head);
  put('.git/info/grafts', `${head}\n`);
  assert.notDeepEqual(history(), before);
  assert.ok(parent);
});

test('a tracked symlink whose target exists nowhere keeps a clean tree clean, because the commit holds the same broken link', { skip: process.platform === 'win32' && 'needs symlinks' }, (t) => {
  const { root, git } = repository(t, { '.gitignore': '.agents/\n', 'src/real.ts': 'export const a = 1;\n' });
  mkdirSync(join(root, '.claude/skills'), { recursive: true });
  symlinkSync('../../.agents/skills/shadcn', join(root, '.claude/skills/shadcn'));
  git('add', '.'); git('commit', '-qm', 'a link to an ignored folder that is not there');
  const inputs = () => analysisInputs(root, loadConfig(root), { worktree: true }, null).worktree;
  assert.deepEqual([inputs().digest, inputs().contentDigest], [null, null], 'a fresh clone has the same broken link as its commit');
  mkdirSync(join(root, '.agents/skills/shadcn'), { recursive: true }); writeFileSync(join(root, '.agents/skills/shadcn/SKILL.md'), 'x\n');
  assert.notEqual(inputs().contentDigest, null, 'when the ignored target exists, it counts for run manifests, as before');
});

test('a tracked symlink to a committed folder keeps a clean tree clean', { skip: process.platform === 'win32' && 'needs symlinks' }, (t) => {
  const { root, git } = repository(t, { '.agents/skills/shadcn/SKILL.md': 'x\n', 'src/real.ts': 'export const a = 1;\n' });
  mkdirSync(join(root, '.claude/skills'), { recursive: true });
  symlinkSync('../../.agents/skills/shadcn', join(root, '.claude/skills/shadcn'));
  git('add', '.'); git('commit', '-qm', 'a link to a committed folder');
  assert.deepEqual([analysisInputs(root, loadConfig(root), { worktree: true }, null).worktree.contentDigest], [null]);
});

test('editing an existing SQL snapshot changes the worktree analysis identity', (t) => {
  const f = repository(t, { 'package.json': '{}', 'schema.sql': '-- dialect: sqlite\nCREATE TABLE users(id INTEGER);' });
  f.put('schema.sql', '-- dialect: sqlite\nCREATE TABLE users(id INTEGER, name TEXT);');
  const first = f.id();
  f.put('schema.sql', '-- dialect: sqlite\nCREATE TABLE users(id INTEGER, age INTEGER);');
  assert.notEqual(f.id(), first);
});
