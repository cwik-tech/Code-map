import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, rmSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { loadAnalysis, saveAnalysis, storeLocation } from '../lib/store.mjs';

const posix = { skip: process.platform === 'win32' && 'needs POSIX owners, modes and symlinks' };
const sha = 'a'.repeat(40);

function analysis(id, inputs = {}, data = {}) {
  return { storeVersion: 1, id, createdAt: '2026-10-22T18:00:00.000Z', findings: [],
    inputs: { manifestVersion: 1, repository: '/work/project', selector: { worktree: false, ref: 'HEAD' }, mapped: 'HEAD', sha, worktree: null,
      labels: { path: 'docs/code-map/test-labels.json', digest: null }, coverage: null, ...inputs },
    data: { sha, analysis: { schemaVersion: 1 }, ...data } };
}

function store(t) {
  const root = mkdtempSync(join(tmpdir(), 'code-map-store-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

/** Writes a stored file as a planted or damaged one would be: without the checks of saveAnalysis. */
function plant(root, stored) {
  mkdirSync(join(root, 'analyses'), { recursive: true, mode: 0o700 });
  writeFileSync(join(root, 'analyses', `${stored.id}.json.gz`), gzipSync(JSON.stringify(stored)), { mode: 0o600 });
}

test('the store ignores a relative XDG_CACHE_HOME, as the XDG specification requires', () => {
  assert.equal(storeLocation(undefined, { XDG_CACHE_HOME: '.cache' }).root, storeLocation(undefined, {}).root);
  assert.equal(storeLocation(undefined, { XDG_CACHE_HOME: '/var/cache/me' }).root, '/var/cache/me/code-map');
});

test('printed commands name the store whenever --store or an environment variable chose it, also when it is the default folder', () => {
  const fallback = join(homedir(), '.cache', 'code-map');
  assert.deepEqual(storeLocation(fallback, { CODE_MAP_STORE: '/x' }), { root: fallback, explicit: true });
  assert.deepEqual(storeLocation(undefined, { CODE_MAP_STORE: fallback }), { root: fallback, explicit: true });
  assert.deepEqual(storeLocation(undefined, { XDG_CACHE_HOME: join(homedir(), '.cache') }), { root: fallback, explicit: true });
  assert.deepEqual(storeLocation(undefined, { XDG_CACHE_HOME: '.cache' }), { root: fallback, explicit: false });
  assert.deepEqual(storeLocation(undefined, {}), { root: fallback, explicit: false });
});

test('saving an analysis survives a store entry that disappears or cannot be read', posix, (t) => {
  const root = store(t);
  mkdirSync(join(root, 'analyses'), { mode: 0o700 });
  symlinkSync(join(root, 'gone'), join(root, 'analyses', 'A-1111111111111111.json.gz'));
  assert.doesNotThrow(() => saveAnalysis(root, analysis('A-2222222222222222')));
});

test('the store refuses an analyses folder that is a symlink or that other users can change, and writes nothing there', posix, (t) => {
  const root = store(t), id = 'A-1111111111111111', elsewhere = join(root, 'elsewhere'), linked = join(root, 'linked'), open = join(root, 'open');
  mkdirSync(elsewhere); mkdirSync(linked);
  symlinkSync(elsewhere, join(linked, 'analyses'));
  assert.throws(() => saveAnalysis(linked, analysis(id)), /analyses is not a private folder that you own: it is a symlink/);
  assert.throws(() => loadAnalysis(linked, id), /analyses is not a private folder that you own: it is a symlink/);
  assert.deepEqual(readdirSync(elsewhere), []);
  mkdirSync(join(open, 'analyses'), { recursive: true });
  chmodSync(join(open, 'analyses'), 0o777);
  assert.throws(() => saveAnalysis(open, analysis(id)), /analyses is not a private folder that you own: other users can change it/);
  assert.throws(() => loadAnalysis(open, id), /analyses is not a private folder that you own: other users can change it/);
  assert.deepEqual(readdirSync(join(open, 'analyses')), []);
});

test('the store refuses a stored file that is a symlink or that other users can change', posix, (t) => {
  const root = store(t), id = 'A-1111111111111111', path = saveAnalysis(root, analysis(id));
  assert.equal(loadAnalysis(root, id).id, id);
  chmodSync(path, 0o666);
  assert.throws(() => loadAnalysis(root, id), /unreadable: other users can change it/);
  rmSync(path);
  const planted = join(root, 'planted.json.gz');
  writeFileSync(planted, gzipSync(JSON.stringify(analysis(id))), { mode: 0o600 });
  symlinkSync(planted, path);
  assert.throws(() => loadAnalysis(root, id), /unreadable: it is a symlink/);
});

test('the store refuses stored values that would reach Git or the file system in an unsafe form, on load and on save', (t) => {
  const root = store(t);
  const unsafe = [
    [{ repository: 'relative/project' }], [{ repository: '/work/pro\0ject' }],
    [{ selector: { worktree: false, ref: '--output=/tmp/x' } }], [{ selector: { worktree: false, ref: 'HEAD\nx' } }],
    [{ selector: { worktree: false, ref: 'a\0b' } }], [{ selector: { worktree: 'yes', ref: null } }],
    [{ labels: { path: '../outside.json', digest: null } }], [{ labels: { path: '/etc/passwd', digest: null } }],
    [{ coverage: { path: 'coverage/../../x.info', digest: 'd', mtime: '2026-10-22T18:00:00.000Z' } }],
    [{ sha: '--output=x' }], [{}, { sha: '-x' }],
  ];
  unsafe.forEach(([inputs, data], index) => {
    const id = `A-${String(index + 1).padStart(16, '0')}`, stored = analysis(id, inputs, data);
    plant(root, stored);
    assert.throws(() => loadAnalysis(root, id), /unreadable/, JSON.stringify([inputs, data]));
    assert.throws(() => saveAnalysis(root, stored), /store refuses analysis/, JSON.stringify([inputs, data]));
  });
  const safe = analysis('A-00000000000000ff', { selector: { worktree: true, ref: null }, sha: 'b'.repeat(64), coverage: { path: 'coverage/lcov.info', digest: 'd', mtime: 't' } }, { sha: 'b'.repeat(64) });
  plant(root, safe);
  assert.equal(loadAnalysis(root, safe.id).id, safe.id, 'a working tree, a SHA-256 commit and a coverage file inside the repository load');
});

test('pruning deletes only the temporary files that Code-map writes, never other old .tmp files', (t) => {
  const root = store(t), folder = join(root, 'analyses'), old = new Date('2026-01-01T00:00:00.000Z');
  mkdirSync(folder, { mode: 0o700 });
  for (const name of ['notes.tmp', 'A-1111111111111111.json.gz.123.0123456789ab.tmp']) { writeFileSync(join(folder, name), 'x'); utimesSync(join(folder, name), old, old); }
  saveAnalysis(root, analysis('A-2222222222222222'));
  assert.deepEqual(readdirSync(folder).sort(), ['A-2222222222222222.json.gz', 'notes.tmp']);
});

test('the store refuses a root folder that other users can change without the sticky bit, and accepts valid refs with spaces', { skip: process.platform === 'win32' && 'needs POSIX modes' }, (t) => {
  const root = mkdtempSync(join(tmpdir(), 'code-map-store-root-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const sha = 'a'.repeat(40);
  const stored = (id, ref) => ({ storeVersion: 1, id, inputs: { repository: '/repo', selector: { worktree: false, ref }, sha, labels: { path: 'shared/labels.json' }, coverage: null },
    data: { sha, analysis: { schemaVersion: 1 } }, findings: [] });
  chmodSync(root, 0o777);
  assert.throws(() => saveAnalysis(root, stored('A-3333333333333333', 'main')), /other users can/);
  chmodSync(root, 0o1777);
  saveAnalysis(root, stored('A-4444444444444444', 'main@{2 days ago}'));
  assert.equal(loadAnalysis(root, 'A-4444444444444444').inputs.selector.ref, 'main@{2 days ago}');
  chmodSync(root, 0o700);
});
